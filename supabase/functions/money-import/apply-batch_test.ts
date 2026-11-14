// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { applyPendingBatch } from "./apply-batch.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { CanonicalTransactionRowInput } from "./types.ts";

interface ApplyBatchRepoState {
  batchUpdates: Array<{ batchId: string; patch: Record<string, unknown> }>;
  reportRows: Record<string, unknown>[];
  repairedTransactions: Array<{ transactionId: string; row: CanonicalTransactionRowInput }>;
  insertedLineItems: Array<{
    transactionId: string;
    lineItem: Record<string, unknown>;
  }>;
  insertLineItemCalls: number;
  insertOrResolveCalls: number;
  appliedCategoryPipelineCalls: Array<{ lineItemIds: string[] }>;
}

function createRepositoryMock(
  options: {
    batchRows?: Record<string, unknown>[];
    resolveTransaction?: (
      row: CanonicalTransactionRowInput,
    ) => Promise<{ transactionId: string; inserted: boolean }>;
    repairResult?: {
      replaced_synthetic_line_items: boolean;
      has_only_synthetic_line_items: boolean;
      has_real_line_items: boolean;
      blocked_by_manual_edit: boolean;
    };
  } = {},
): { repository: MoneyImportRepository; state: ApplyBatchRepoState } {
  const state: ApplyBatchRepoState = {
    batchUpdates: [],
    reportRows: [],
    repairedTransactions: [],
    insertedLineItems: [],
    insertLineItemCalls: 0,
    insertOrResolveCalls: 0,
    appliedCategoryPipelineCalls: [],
  };

  let lineCounter = 0;

  const repository: MoneyImportRepository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    getGrantByToken: async () => null,
    getGrantById: async () => null,
    isAuthUserAllowed: async () => false,
    markGrantUsed: async () => {},
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
      meta: {},
      parsed_through_at: null,
    }),
    updateImportBatch: async (batchId, patch) => {
      state.batchUpdates.push({ batchId, patch });
    },
    getExistingTransactionStates: async () => [],
    listBatchBrandResolutions: async () => [],
    listReportRowsByBatch: async () => options.batchRows ?? [],
    deleteReportRowsByBatch: async () => {},
    resolveAccountIdForRow: async (_payer, row) => row.account_id ?? "acc-1",
    resolveCardIdForRow: async () => "card-1",
    resolveBrandIdForRow: async () => null,
    findExistingTransactionId: async () => null,
    findExistingLineItemId: async () => null,
    insertOrResolveTransaction: async (row) => {
      state.insertOrResolveCalls += 1;
      if (options.resolveTransaction) return await options.resolveTransaction(row);
      if (row.external_id === "dup-synth" || row.external_id === "dup-csv") {
        return { transactionId: "tx-existing", inserted: false };
      }
      if (row.external_id === "dup-manual") {
        return { transactionId: "tx-manual", inserted: false };
      }
      return { transactionId: "tx-new", inserted: true };
    },
    repairExistingTransactionDetails: async (transactionId, row) => {
      state.repairedTransactions.push({ transactionId, row });
      return (
        options.repairResult ?? {
          replaced_synthetic_line_items: true,
          has_only_synthetic_line_items: true,
          has_real_line_items: false,
          blocked_by_manual_edit: transactionId === "tx-manual",
        }
      );
    },
    insertLineItemIfNew: async (transactionId, lineItem) => {
      state.insertLineItemCalls += 1;
      state.insertedLineItems.push({
        transactionId,
        lineItem: lineItem as Record<string, unknown>,
      });
      lineCounter += 1;
      return { lineItemId: `line-${lineCounter}`, inserted: true };
    },
    insertReportRow: async (payload) => {
      state.reportRows.push(payload);
      return `report-${state.reportRows.length}`;
    },
    applyCategoryRulePipeline: async (lineItemIds) => {
      state.appliedCategoryPipelineCalls.push({ lineItemIds });
      return { runs: [] };
    },
  };

  return { repository, state };
}

function previewTxRow(
  partial: Partial<CanonicalTransactionRowInput> & Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    row_kind: "transaction",
    status: "inserted",
    message: null,
    payload: {
      posted_at: "2026-01-01T00:00:00.000Z",
      amount: 10,
      transaction_type: "expense",
      source: "tbank_web",
      merchant_name: "Shop",
      account_id: "acc-1",
      ...partial,
    },
  };
}

Deno.test(
  "applyPendingBatch repairs extension stub when real receipt line items arrive",
  async () => {
    const { repository, state } = createRepositoryMock({
      batchRows: [
        previewTxRow({
          external_id: "dup-synth",
          receipt_enrichment_status: "ok",
          line_items: [
            { title: "Milk", amount: 4, raw_payload: { source: "receipt" } },
            { title: "Bread", amount: 6, raw_payload: { source: "receipt" } },
          ],
        }),
      ],
    });

    const payload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ status: string; line_results?: Array<{ status: string }> }>;
    }>(await applyPendingBatch("batch-1", { repository }), 200);

    assertEquals(payload.inserted, 0);
    assertEquals(payload.skipped, 1);
    assertEquals(payload.error_count, 0);
    assertEquals(state.repairedTransactions.length, 1);
    assertEquals(state.repairedTransactions[0].transactionId, "tx-existing");
    assertEquals(state.insertedLineItems.length, 2);
    assertEquals(payload.row_results[0].line_results?.[0]?.status, "inserted");
    assertEquals(payload.row_results[0].line_results?.[1]?.status, "inserted");
  },
);

Deno.test(
  "applyPendingBatch repairs CSV placeholder stubs marked with is_placeholder",
  async () => {
    const { repository, state } = createRepositoryMock({
      batchRows: [
        previewTxRow({
          external_id: "dup-csv",
          source: "tbank_csv",
          amount: 100,
          line_items: [
            { title: "Milk", amount: 40, raw_payload: { source: "receipt" } },
            { title: "Bread", amount: 60, raw_payload: { source: "receipt" } },
          ],
        }),
      ],
      repairResult: {
        replaced_synthetic_line_items: true,
        has_only_synthetic_line_items: true,
        has_real_line_items: false,
        blocked_by_manual_edit: false,
      },
    });

    await assertJsonResponse(await applyPendingBatch("batch-1", { repository }), 200);

    assertEquals(state.repairedTransactions.length, 1);
    assertEquals(state.repairedTransactions[0].transactionId, "tx-existing");
    assertEquals(state.insertedLineItems.length, 2);
  },
);

Deno.test("applyPendingBatch does not repair newly inserted transactions", async () => {
  const { repository, state } = createRepositoryMock({
    batchRows: [
      previewTxRow({
        external_id: "fresh-tx",
        line_items: [{ title: "Coffee", amount: 10, raw_payload: { source: "receipt" } }],
      }),
    ],
  });

  const payload = await assertJsonResponse<{ inserted: number; skipped: number }>(
    await applyPendingBatch("batch-1", { repository }),
    200,
  );

  assertEquals(payload.inserted, 1);
  assertEquals(payload.skipped, 0);
  assertEquals(state.repairedTransactions.length, 0);
  assertEquals(state.insertedLineItems.length, 1);
});

Deno.test(
  "applyPendingBatch skips line inserts when repair is blocked by manual edits",
  async () => {
    const { repository, state } = createRepositoryMock({
      batchRows: [
        previewTxRow({
          external_id: "dup-manual",
          line_items: [
            { title: "Milk", amount: 4, raw_payload: { source: "receipt" } },
            { title: "Bread", amount: 6, raw_payload: { source: "receipt" } },
          ],
        }),
      ],
    });

    const payload = await assertJsonResponse<{
      skipped: number;
      row_results: Array<{ message: string | null; line_results?: unknown[] }>;
    }>(await applyPendingBatch("batch-1", { repository }), 200);

    assertEquals(payload.skipped, 1);
    assertEquals(state.repairedTransactions.length, 1);
    assertEquals(state.insertLineItemCalls, 0);
    assertEquals(payload.row_results[0].message, "Existing line items were edited manually");
    assertEquals(payload.row_results[0].line_results, []);
    const txReport = state.reportRows.find((row) => row.row_kind === "transaction");
    assertEquals(txReport?.message, "Existing line items were edited manually");
  },
);

Deno.test("applyPendingBatch appends a balancing line item for small receipt deltas", async () => {
  const { repository, state } = createRepositoryMock({
    batchRows: [
      previewTxRow({
        external_id: "fresh-balance",
        amount: 1000,
        line_items: [
          { title: "A", amount: 500, raw_payload: { source: "receipt" } },
          { title: "B", amount: 440, raw_payload: { source: "receipt" } },
        ],
      }),
    ],
  });

  await assertJsonResponse(await applyPendingBatch("batch-1", { repository }), 200);

  assertEquals(state.insertedLineItems.length, 3);
  const balancing = state.insertedLineItems[2].lineItem;
  assertEquals(balancing.amount, 60);
  assertEquals((balancing.raw_payload as Record<string, unknown>).source, "balancing");
});

Deno.test(
  "applyPendingBatch does not re-append balancing when real receipt lines already exist",
  async () => {
    const { repository, state } = createRepositoryMock({
      batchRows: [
        previewTxRow({
          external_id: "dup-synth",
          amount: 1000,
          line_items: [
            { title: "A", amount: 500, raw_payload: { source: "receipt" } },
            { title: "B", amount: 440, raw_payload: { source: "receipt" } },
          ],
        }),
      ],
      repairResult: {
        replaced_synthetic_line_items: false,
        has_only_synthetic_line_items: false,
        has_real_line_items: true,
        blocked_by_manual_edit: false,
      },
    });

    await assertJsonResponse(await applyPendingBatch("batch-1", { repository }), 200);

    assertEquals(state.repairedTransactions.length, 1);
    assertEquals(state.insertedLineItems.length, 2);
    assertEquals(
      state.insertedLineItems.every(
        (entry) =>
          (entry.lineItem.raw_payload as Record<string, unknown> | undefined)?.source !==
          "balancing",
      ),
      true,
    );
  },
);

Deno.test(
  "applyPendingBatch errors when receipt total diverges beyond the balancing share",
  async () => {
    const { repository, state } = createRepositoryMock({
      batchRows: [
        previewTxRow({
          external_id: "dup-synth",
          amount: 1000,
          line_items: [{ title: "Wrong receipt", amount: 100, raw_payload: { source: "receipt" } }],
        }),
      ],
    });

    const payload = await assertJsonResponse<{
      error_count: number;
      row_results: Array<{
        status: string;
        message: string | null;
        transaction_id?: string | null;
      }>;
    }>(await applyPendingBatch("batch-1", { repository }), 200);

    assertEquals(payload.error_count, 1);
    assertEquals(payload.row_results[0].status, "error");
    assertEquals(payload.row_results[0].message, "Receipt total does not match transaction amount");
    assertEquals(payload.row_results[0].transaction_id, null);
    assertEquals(state.insertOrResolveCalls, 0);
    assertEquals(state.repairedTransactions.length, 0);
    assertEquals(state.insertLineItemCalls, 0);
  },
);

Deno.test(
  "applyPendingBatch rejects oversized imbalance before inserting a new transaction",
  async () => {
    const { repository, state } = createRepositoryMock({
      batchRows: [
        previewTxRow({
          external_id: "fresh-imbalance",
          amount: 1000,
          line_items: [{ title: "Wrong receipt", amount: 100, raw_payload: { source: "receipt" } }],
        }),
      ],
    });

    const payload = await assertJsonResponse<{
      inserted: number;
      error_count: number;
      row_results: Array<{ status: string; transaction_id?: string | null }>;
    }>(await applyPendingBatch("batch-1", { repository }), 200);

    assertEquals(payload.inserted, 0);
    assertEquals(payload.error_count, 1);
    assertEquals(payload.row_results[0].status, "error");
    assertEquals(payload.row_results[0].transaction_id, null);
    assertEquals(state.insertOrResolveCalls, 0);
    assertEquals(state.insertLineItemCalls, 0);
  },
);
