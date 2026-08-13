// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { applyBatchAction } from "./apply-batch.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext, CanonicalTransactionRowInput, ImportLineItemInput } from "./types.ts";

interface ApplyBatchRepoState {
  reportRows: Record<string, unknown>[];
  batchUpdates: Array<{ batchId: string; patch: Record<string, unknown> }>;
  repairCalls: Array<{ transactionId: string; row: CanonicalTransactionRowInput }>;
  insertedLineItems: Array<{
    transactionId: string;
    lineItem: ImportLineItemInput;
    isPlaceholder: boolean;
  }>;
}

interface ApplyBatchRowResult {
  idx: number;
  status: string;
  message: string | null;
  transaction_id: string | null;
  line_results?: Array<{ line_index: number; status: string; message: string | null }>;
}

interface ApplyBatchResponse {
  batch_id: string;
  inserted: number;
  skipped: number;
  error_count: number;
  row_results: ApplyBatchRowResult[];
}

function createRepositoryMock(options: {
  storedRows: CanonicalTransactionRowInput[];
  /** Transactions that already exist; anything else is inserted as new. */
  existingTransactionIdByExternalId?: Record<string, string>;
  blockedByManualEdit?: boolean;
}): { repository: MoneyImportRepository; state: ApplyBatchRepoState } {
  const state: ApplyBatchRepoState = {
    reportRows: [],
    batchUpdates: [],
    repairCalls: [],
    insertedLineItems: [],
  };

  let txCounter = 0;
  let lineCounter = 0;
  const existingByExternalId = options.existingTransactionIdByExternalId ?? {};

  const repository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    findLastImportedAt: async () => null,
    createImportSession: async () => ({ id: "session-1" }),
    getImportSessionForUser: async () => null,
    getImportSessionById: async () => null,
    updateImportSession: async () => {},
    createImportBatch: async () => "batch-1",
    getImportBatch: async () => ({
      id: "batch-1",
      status: "pending",
      payer_person_id: "person-1",
      source: "tbank_web",
      window_from: null,
      window_to: null,
      meta: null,
      parsed_through_at: null,
    }),
    getImportBatchForUser: async () => ({
      id: "batch-1",
      status: "pending",
      payer_person_id: "person-1",
      source: "tbank_web",
      window_from: null,
      window_to: null,
      meta: null,
      parsed_through_at: null,
    }),
    updateImportBatch: async (batchId: string, patch: Record<string, unknown>) => {
      state.batchUpdates.push({ batchId, patch });
    },
    getExistingTransactionStates: async () => [],
    listReportRowsByBatch: async () =>
      options.storedRows.map((row, index) => ({
        id: `stored-${index}`,
        row_kind: "transaction",
        status: "pending",
        message: null,
        payload: row as unknown as Record<string, unknown>,
      })),
    deleteReportRowsByBatch: async () => {},
    resolveAccountIdForRow: async () => "acc-1",
    resolveCardIdForRow: async () => "card-1",
    findExistingTransactionId: async () => null,
    findExistingLineItemId: async () => null,
    insertOrResolveTransaction: async (row: CanonicalTransactionRowInput) => {
      const externalId = row.external_id ?? "";
      const existingId = existingByExternalId[externalId];
      if (existingId) return { transactionId: existingId, inserted: false };
      txCounter += 1;
      return { transactionId: `tx-${txCounter}`, inserted: true };
    },
    repairExistingTransactionDetails: async (
      transactionId: string,
      row: CanonicalTransactionRowInput,
    ) => {
      state.repairCalls.push({ transactionId, row });
      return {
        replaced_synthetic_line_items: !options.blockedByManualEdit,
        has_only_synthetic_line_items: true,
        has_real_line_items: false,
        blocked_by_manual_edit: options.blockedByManualEdit === true,
      };
    },
    insertLineItemIfNew: async (
      transactionId: string,
      lineItem: ImportLineItemInput,
      _importHash: string,
      _fallbackAmount: number,
      isPlaceholder = false,
    ) => {
      state.insertedLineItems.push({ transactionId, lineItem, isPlaceholder });
      lineCounter += 1;
      return { lineItemId: `line-${lineCounter}`, inserted: true };
    },
    insertReportRow: async (payload: Record<string, unknown>) => {
      state.reportRows.push(payload);
      return `report-${state.reportRows.length}`;
    },
  } as unknown as MoneyImportRepository;

  return { repository, state };
}

const userAuth: AuthContext = {
  mode: "user",
  token: "token",
  userId: "user-1",
  email: "user@example.com",
};

function txRow(partial: Partial<CanonicalTransactionRowInput> = {}): CanonicalTransactionRowInput {
  return {
    source: "tbank_web",
    posted_at: "2026-03-05T10:00:00.000Z",
    amount: -1000,
    transaction_type: "expense",
    currency: "RUB",
    merchant_name: "Store",
    ...partial,
  };
}

function realReceipt(first: number, second: number): ImportLineItemInput[] {
  return [
    { title: "Milk", amount: first, raw_payload: { source: "receipt" } },
    { title: "Dog food", amount: second, raw_payload: { source: "receipt" } },
  ];
}

Deno.test("applyBatchAction replaces an extension placeholder with the real receipt", async () => {
  const { repository, state } = createRepositoryMock({
    storedRows: [
      txRow({ external_id: "op-1", amount: -1000, line_items: realReceipt(-400, -600) }),
    ],
    existingTransactionIdByExternalId: { "op-1": "tx-existing" },
  });

  const payload = await assertJsonResponse<ApplyBatchResponse>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository }),
    200,
  );

  assertEquals(state.repairCalls.length, 1);
  assertEquals(state.repairCalls[0].transactionId, "tx-existing");
  assertEquals(payload.row_results[0].status, "skipped");
  assertEquals(state.insertedLineItems.length, 2);
});

Deno.test("applyBatchAction replaces a CSV placeholder with the real receipt", async () => {
  // The CSV placeholder carries the raw statement row in `raw_payload` and therefore has no
  // `source` key at all. It is recognised only through the explicit `is_placeholder` flag.
  const { repository, state } = createRepositoryMock({
    storedRows: [
      txRow({
        external_id: "op-csv",
        amount: -1000,
        line_items: realReceipt(-400, -600),
      }),
    ],
    existingTransactionIdByExternalId: { "op-csv": "tx-from-csv" },
  });

  const payload = await assertJsonResponse<ApplyBatchResponse>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository }),
    200,
  );

  assertEquals(state.repairCalls.length, 1);
  assertEquals(state.repairCalls[0].transactionId, "tx-from-csv");
  // Exactly the two receipt lines land; no third line survives next to them.
  assertEquals(state.insertedLineItems.length, 2);
  assertEquals(payload.row_results[0].line_results?.length, 2);
});

Deno.test("applyBatchAction does not repair a newly inserted transaction", async () => {
  const { repository, state } = createRepositoryMock({
    storedRows: [
      txRow({ external_id: "op-new", amount: -1000, line_items: realReceipt(-400, -600) }),
    ],
  });

  const payload = await assertJsonResponse<ApplyBatchResponse>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository }),
    200,
  );

  assertEquals(state.repairCalls.length, 0);
  assertEquals(payload.row_results[0].status, "inserted");
  assertEquals(state.insertedLineItems.length, 2);
});

Deno.test("applyBatchAction marks a placeholder line item as such when persisting it", async () => {
  const { repository, state } = createRepositoryMock({
    storedRows: [txRow({ external_id: "op-no-receipt", amount: -1000 })],
  });

  await assertJsonResponse<ApplyBatchResponse>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository }),
    200,
  );

  assertEquals(state.insertedLineItems.length, 1);
  assertEquals(state.insertedLineItems[0].isPlaceholder, true);
});

Deno.test("applyBatchAction protects manually edited line items", async () => {
  const { repository, state } = createRepositoryMock({
    storedRows: [
      txRow({ external_id: "op-manual", amount: -1000, line_items: realReceipt(-400, -600) }),
    ],
    existingTransactionIdByExternalId: { "op-manual": "tx-manual" },
    blockedByManualEdit: true,
  });

  const payload = await assertJsonResponse<ApplyBatchResponse>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository }),
    200,
  );

  assertEquals(payload.row_results[0].status, "skipped");
  assertEquals(payload.row_results[0].message, "Existing line items were edited manually");
  assertEquals(state.insertedLineItems.length, 0);

  const transactionReportRow = state.reportRows.find((row) => row.row_kind === "transaction");
  assertEquals(transactionReportRow?.status, "skipped");
  assertEquals(transactionReportRow?.message, "Existing line items were edited manually");
});

Deno.test("applyBatchAction adds a balancing line item when the receipt is short", async () => {
  const { repository, state } = createRepositoryMock({
    storedRows: [
      txRow({ external_id: "op-balance", amount: 1000, line_items: realReceipt(500, 440) }),
    ],
  });

  const payload = await assertJsonResponse<ApplyBatchResponse>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository }),
    200,
  );

  assertEquals(payload.row_results[0].status, "inserted");
  assertEquals(state.insertedLineItems.length, 3);

  const balancing = state.insertedLineItems[2].lineItem;
  assertEquals(balancing.amount, 60);
  assertEquals((balancing.raw_payload as Record<string, unknown>).source, "balancing");
  assertEquals(state.insertedLineItems[2].isPlaceholder, false);
});

Deno.test("applyBatchAction reports a receipt that cannot belong to the transaction", async () => {
  const { repository, state } = createRepositoryMock({
    storedRows: [
      txRow({ external_id: "op-mismatch", amount: 1000, line_items: realReceipt(60, 40) }),
    ],
    existingTransactionIdByExternalId: { "op-mismatch": "tx-mismatch" },
  });

  const payload = await assertJsonResponse<ApplyBatchResponse>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository }),
    200,
  );

  assertEquals(payload.row_results[0].status, "error");
  assertEquals(payload.row_results[0].message, "Receipt total does not match transaction amount");
  // The destructive repair must not have run: it deletes existing line items in a separate
  // request, and the exception would leave the transaction with no composition at all.
  assertEquals(state.repairCalls.length, 0);
  assertEquals(state.insertedLineItems.length, 0);
  assertEquals(payload.error_count, 1);
});
