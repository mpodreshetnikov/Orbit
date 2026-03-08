// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext, CanonicalTransactionRowInput } from "./types.ts";
import {
  applyBatchAction,
  discardBatchAction,
  previewRowsAction,
} from "./preview-batch-actions.ts";

interface RepoState {
  batchUpdates: Array<{ batchId: string; patch: Record<string, unknown> }>;
  reportRows: Record<string, unknown>[];
  deletedBatchIds: string[];
  listedBatchIds: string[];
}

function createRepositoryMock(
  options: {
    batch?: Record<string, unknown> | null;
    batchRows?: Record<string, unknown>[];
  } = {},
): { repository: MoneyImportRepository; state: RepoState } {
  const state: RepoState = {
    batchUpdates: [],
    reportRows: [],
    deletedBatchIds: [],
    listedBatchIds: [],
  };

  const repository: MoneyImportRepository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    findLastImportedAt: async () => null,
    createImportSession: async () => ({ id: "session-1" }),
    getImportSessionForUser: async () => null,
    getImportSessionById: async () => null,
    updateImportSession: async () => {},
    createImportBatch: async () => "batch-1",
    getImportBatch: async () =>
      options.batch === undefined
        ? {
            id: "batch-1",
            status: "running",
            payer_person_id: "person-1",
            source: "tbank_web",
            import_type: "file",
            file_path: null,
            parsed_transactions_count: 0,
            inserted_count: 0,
            skipped_count: 0,
            error_count: 0,
          }
        : options.batch,
    updateImportBatch: async (batchId, patch) => {
      state.batchUpdates.push({ batchId, patch });
    },
    listReportRowsByBatch: async (batchId) => {
      state.listedBatchIds.push(batchId);
      return options.batchRows ?? [];
    },
    deleteReportRowsByBatch: async (batchId) => {
      state.deletedBatchIds.push(batchId);
    },
    findExistingTransactionId: async (row) => (row.external_id === "dup-tx" ? "tx-existing" : null),
    findExistingLineItemId: async (transactionId, _importHash) =>
      transactionId === "tx-existing" ? "line-existing" : null,
    resolveAccountIdForRow: async (
      _payerPersonId: string,
      row: CanonicalTransactionRowInput,
      _fallbackSource: string,
      defaultAccountId?: string | null,
    ) => {
      if (row.external_id === "account-error") {
        throw new Error("No money account found for source tbank");
      }
      return row.account_id ?? defaultAccountId ?? "acc-1";
    },
    resolveCardIdForRow: async () => null,
    insertOrResolveTransaction: async (row) => ({
      transactionId: row.external_id === "dup-tx" ? "tx-existing" : "tx-new",
      inserted: row.external_id !== "dup-tx",
    }),
    insertLineItemIfNew: async (_transactionId, lineItem) => ({
      lineItemId: lineItem.title === "duplicate-line" ? "line-existing" : "line-new",
      inserted: lineItem.title !== "duplicate-line",
    }),
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
    posted_at: "2026-01-01T00:00:00.000Z",
    amount: 10,
    transaction_type: "expense",
    source: "tbank_web",
    line_items: [],
    ...partial,
  };
}

Deno.test("previewRowsAction predicts row outcomes without mutating transactions", async () => {
  const { repository, state } = createRepositoryMock();

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
  }>(
    await previewRowsAction(
      {
        payer_person_id: "person-1",
        source: "tbank_web",
        batch_id: "batch-1",
        rows: [
          txRow({ external_id: "fresh-tx", line_items: [{ title: "new-line", amount: 10 }] }),
          txRow({ external_id: "dup-tx", line_items: [{ title: "duplicate-line", amount: 5 }] }),
          txRow({ external_id: "account-error" }),
        ],
      },
      userAuth,
      { repository, now: () => new Date("2026-01-01T00:00:00.000Z") },
    ),
    200,
  );

  assertEquals(payload.inserted, 1);
  assertEquals(payload.skipped, 1);
  assertEquals(payload.error_count, 1);
  assertEquals(state.batchUpdates.length, 1);
  assertEquals(state.batchUpdates[0].patch.status, "pending");
  assertEquals(state.reportRows.length, 5);
});

Deno.test("applyBatchAction replays stored preview rows into final rows", async () => {
  const { repository, state } = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "pending",
      payer_person_id: "person-1",
      source: "tbank_web",
      import_type: "file",
      file_path: "bank.csv",
      parsed_transactions_count: 2,
      inserted_count: 1,
      skipped_count: 1,
      error_count: 0,
    },
    batchRows: [
      {
        id: "row-1",
        row_kind: "transaction",
        payload: txRow({
          external_id: "fresh-tx",
          line_items: [{ title: "new-line", amount: 10 }],
        }),
      },
      {
        id: "row-2",
        row_kind: "line_item",
        payload: { title: "new-line", amount: 10 },
      },
    ],
  });

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
  }>(
    await applyBatchAction(
      {
        batch_id: "batch-1",
      },
      userAuth,
      { repository, now: () => new Date("2026-01-01T00:00:00.000Z") },
    ),
    200,
  );

  assertEquals(payload.inserted, 1);
  assertEquals(payload.skipped, 0);
  assertEquals(payload.error_count, 0);
  assertEquals(state.listedBatchIds, ["batch-1"]);
  assertEquals(state.deletedBatchIds, ["batch-1"]);
  assertEquals(state.batchUpdates[0].patch.status, "running");
  assertEquals(state.batchUpdates[state.batchUpdates.length - 1].patch.status, "completed");
});

Deno.test("discardBatchAction marks preview batch discarded", async () => {
  const { repository, state } = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "pending",
      payer_person_id: "person-1",
      source: "tbank_web",
    },
  });

  const payload = await assertJsonResponse<{ batch_id: string; status: string }>(
    await discardBatchAction({ batch_id: "batch-1" }, userAuth, {
      repository,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    }),
    200,
  );

  assertEquals(payload.batch_id, "batch-1");
  assertEquals(payload.status, "discarded");
  assertEquals(state.batchUpdates.length, 1);
  assertEquals(state.batchUpdates[0].patch.status, "discarded");
});
