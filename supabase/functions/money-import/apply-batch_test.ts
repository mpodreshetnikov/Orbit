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

interface RepositoryMockOptions {
  /** Rows already stored on the batch by the preview step. */
  storedRows: CanonicalTransactionRowInput[];
  /** External ids that resolve to an already existing transaction. */
  existingExternalIds?: string[];
  /** Repair verdict for a given transaction id. */
  blockedByManualEdit?: boolean;
}

function createRepositoryMock(options: RepositoryMockOptions): {
  repository: MoneyImportRepository;
  state: ApplyBatchRepoState;
} {
  const state: ApplyBatchRepoState = {
    reportRows: [],
    batchUpdates: [],
    repairCalls: [],
    insertedLineItems: [],
  };

  const storedBatch: Record<string, unknown> = {
    id: "batch-1",
    status: "pending",
    payer_person_id: "person-1",
    source: "tbank_web",
    window_from: null,
    window_to: null,
    meta: null,
  };
  const existingExternalIds = new Set(options.existingExternalIds ?? []);
  let txCounter = 0;
  let lineCounter = 0;

  const repository: MoneyImportRepository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    findLastImportedAt: async () => null,
    createImportSession: async () => ({ id: "session-1" }),
    getImportSessionForUser: async () => null,
    getImportSessionById: async () => null,
    updateImportSession: async () => {},
    createImportBatch: async () => "batch-1",
    getImportBatch: async () => storedBatch,
    getImportBatchForUser: async () => storedBatch,
    updateImportBatch: async (batchId, patch) => {
      state.batchUpdates.push({ batchId, patch });
    },
    listReportRowsByBatch: async () =>
      options.storedRows.map((row, index) => ({
        row_kind: "transaction",
        status: "pending",
        message: null,
        source_row_index: index,
        payload: row,
      })),
    deleteReportRowsByBatch: async () => {},
    resolveAccountIdForRow: async () => "acc-1",
    resolveCardIdForRow: async () => "card-1",
    getExistingTransactionStates: async () => [],
    findExistingTransactionId: async () => null,
    findExistingLineItemId: async () => null,
    insertOrResolveTransaction: async (row) => {
      const externalId = row.external_id ?? "";
      if (existingExternalIds.has(externalId)) {
        return { transactionId: `tx-existing-${externalId}`, inserted: false };
      }
      txCounter += 1;
      return { transactionId: `tx-${txCounter}`, inserted: true };
    },
    repairExistingTransactionDetails: async (transactionId, row) => {
      state.repairCalls.push({ transactionId, row });
      return {
        replaced_synthetic_line_items: !options.blockedByManualEdit,
        has_only_synthetic_line_items: false,
        has_real_line_items: true,
        blocked_by_manual_edit: options.blockedByManualEdit === true,
      };
    },
    insertLineItemIfNew: async (transactionId, lineItem, _importHash, _fallback, isPlaceholder) => {
      state.insertedLineItems.push({
        transactionId,
        lineItem,
        isPlaceholder: isPlaceholder === true,
      });
      lineCounter += 1;
      return { lineItemId: `line-${lineCounter}`, inserted: true };
    },
    insertReportRow: async (payload) => {
      state.reportRows.push(payload);
      return `report-${state.reportRows.length}`;
    },
  };

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
    posted_at: "2026-01-05T10:00:00.000Z",
    amount: -1000,
    transaction_type: "expense",
    merchant_name: "Пятёрочка",
    ...partial,
  };
}

function transactionReportRows(state: ApplyBatchRepoState): Record<string, unknown>[] {
  return state.reportRows.filter((row) => row.row_kind === "transaction");
}

Deno.test("applyBatchAction replaces an extension placeholder with the real receipt", async () => {
  const { repository, state } = createRepositoryMock({
    existingExternalIds: ["op-1"],
    storedRows: [
      txRow({
        external_id: "op-1",
        line_items: [
          { title: "Молоко", amount: -400 },
          { title: "Корм для собаки", amount: -600 },
        ],
      }),
    ],
  });

  const response = await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository });
  await assertJsonResponse(response, 200);

  assertEquals(state.repairCalls.length, 1);
  assertEquals(state.repairCalls[0].transactionId, "tx-existing-op-1");
  assertEquals(state.insertedLineItems.length, 2);
  assertEquals(
    state.insertedLineItems.map((entry) => entry.isPlaceholder),
    [false, false],
  );
});

Deno.test("applyBatchAction replaces a CSV placeholder with the real receipt", async () => {
  // A statement row carries no `source` marker in raw_payload at all — it is recognised
  // as a placeholder only through the explicit flag.
  const { repository, state } = createRepositoryMock({
    existingExternalIds: ["op-2"],
    storedRows: [
      txRow({
        external_id: "op-2",
        raw_payload: { "Дата операции": "05.01.2026 13:00:00" },
        line_items: [
          { title: "Хлеб", amount: -300 },
          { title: "Шампунь", amount: -700 },
        ],
      }),
    ],
  });

  const response = await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository });
  await assertJsonResponse(response, 200);

  assertEquals(state.repairCalls.length, 1);
  assertEquals(state.insertedLineItems.length, 2);
});

Deno.test("applyBatchAction does not repair a freshly inserted transaction", async () => {
  const { repository, state } = createRepositoryMock({
    storedRows: [
      txRow({
        external_id: "op-3",
        line_items: [
          { title: "Молоко", amount: -400 },
          { title: "Хлеб", amount: -600 },
        ],
      }),
    ],
  });

  const response = await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository });
  await assertJsonResponse(response, 200);

  assertEquals(state.repairCalls.length, 0);
  assertEquals(state.insertedLineItems.length, 2);
});

Deno.test("applyBatchAction keeps a manually edited composition untouched", async () => {
  const { repository, state } = createRepositoryMock({
    existingExternalIds: ["op-4"],
    blockedByManualEdit: true,
    storedRows: [
      txRow({
        external_id: "op-4",
        line_items: [
          { title: "Молоко", amount: -400 },
          { title: "Хлеб", amount: -600 },
        ],
      }),
    ],
  });

  const response = await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository });
  await assertJsonResponse(response, 200);

  assertEquals(state.repairCalls.length, 1);
  assertEquals(state.insertedLineItems.length, 0);
  const reportRows = transactionReportRows(state);
  assertEquals(reportRows.length, 1);
  assertEquals(reportRows[0].status, "skipped");
  assertEquals(reportRows[0].message, "Existing line items were edited manually");
});

Deno.test("applyBatchAction appends a balancing line item when the receipt is short", async () => {
  const { repository, state } = createRepositoryMock({
    storedRows: [
      txRow({
        external_id: "op-5",
        amount: -1000,
        line_items: [
          { title: "Кофе", amount: -500 },
          { title: "Круассан", amount: -440 },
        ],
      }),
    ],
  });

  const response = await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository });
  await assertJsonResponse(response, 200);

  assertEquals(state.insertedLineItems.length, 3);
  const balancing = state.insertedLineItems[2].lineItem;
  assertEquals(balancing.amount, -60);
  assertEquals((balancing.raw_payload as Record<string, unknown>).source, "balancing");
  assertEquals(state.insertedLineItems[2].isPlaceholder, false);
});

Deno.test("applyBatchAction rejects a receipt that cannot belong to the operation", async () => {
  const { repository, state } = createRepositoryMock({
    existingExternalIds: ["op-6"],
    storedRows: [
      txRow({
        external_id: "op-6",
        amount: -1000,
        line_items: [{ title: "Кофе", amount: -100 }],
      }),
    ],
  });

  const response = await applyBatchAction({ batch_id: "batch-1" }, userAuth, { repository });
  await assertJsonResponse(response, 200);

  const reportRows = transactionReportRows(state);
  assertEquals(reportRows.length, 1);
  assertEquals(reportRows[0].status, "error");
  assertEquals(reportRows[0].message, "Receipt total does not match transaction amount");
  // The guard runs before the destructive step, so nothing was deleted.
  assertEquals(state.repairCalls.length, 0);
  assertEquals(state.insertedLineItems.length, 0);
});
