// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { applyRowsAction } from "./apply-rows.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext, CanonicalTransactionRowInput } from "./types.ts";

interface ApplyRowsRepoState {
  createdBatchPayloads: Record<string, unknown>[];
  sessionUpdates: Array<{ sessionId: string; patch: Record<string, unknown> }>;
  batchUpdates: Array<{ batchId: string; patch: Record<string, unknown> }>;
  reportRows: Record<string, unknown>[];
}

function createRepositoryMock(
  options: {
    batchBefore?: Record<string, unknown> | null;
    updateBatchError?: string | null;
  } = {},
): { repository: MoneyImportRepository; state: ApplyRowsRepoState } {
  const state: ApplyRowsRepoState = {
    createdBatchPayloads: [],
    sessionUpdates: [],
    batchUpdates: [],
    reportRows: [],
  };

  let txCounter = 0;
  let lineCounter = 0;

  const repository: MoneyImportRepository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    findLastImportedAt: async () => null,
    createImportSession: async () => ({ id: "session-1" }),
    getImportSessionForUser: async () => null,
    getImportSessionById: async () => null,
    updateImportSession: async (sessionId, patch) => {
      state.sessionUpdates.push({ sessionId, patch });
    },
    createImportBatch: async (payload) => {
      state.createdBatchPayloads.push(payload);
      return "batch-created";
    },
    getImportBatch: async () =>
      options.batchBefore === undefined
        ? {
            id: "batch-1",
            parsed_transactions_count: 0,
            inserted_count: 0,
            skipped_count: 0,
            error_count: 0,
          }
        : options.batchBefore,
    updateImportBatch: async (batchId, patch) => {
      if (options.updateBatchError) throw new Error(options.updateBatchError);
      state.batchUpdates.push({ batchId, patch });
    },
    resolveAccountIdForRow: async (_payerPersonId, row) => {
      if (row.external_id === "account-error") throw new Error("account lookup failed");
      return row.account_id ?? "acc-1";
    },
    insertOrResolveTransaction: async (row) => {
      if (row.external_id === "dup-tx") {
        return { transactionId: "tx-dup", inserted: false };
      }
      if (row.external_id === "err-tx") {
        throw new Error("row insert failed");
      }
      txCounter += 1;
      return { transactionId: `tx-${txCounter}`, inserted: true };
    },
    insertLineItemIfNew: async (_transactionId, lineItem) => {
      if (lineItem.title === "dup") return { lineItemId: "line-dup", inserted: false };
      if (lineItem.title === "err") throw new Error("line item failed");
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
    posted_at: "2026-01-01T00:00:00.000Z",
    amount: 10,
    transaction_type: "expense",
    ...partial,
  };
}

Deno.test("applyRowsAction validates rows array and payer person", async () => {
  const { repository } = createRepositoryMock();

  const badRowsPayload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction({ rows: "nope" }, userAuth, { repository }),
    400,
  );
  assertEquals(badRowsPayload.error, "rows must be an array");

  const missingPayerPayload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction({ rows: [txRow()] }, userAuth, { repository }),
    400,
  );
  assertEquals(missingPayerPayload.error, "payer_person_id is required");
});

Deno.test("applyRowsAction rejects expired session auth", async () => {
  const { repository } = createRepositoryMock();
  const sessionAuth: AuthContext = {
    mode: "session",
    token: "session-token",
    session: {
      id: "session-1",
      status: "running",
      revoked_at: null,
      expires_at: "2026-01-01T00:00:00.000Z",
    },
  };

  const payload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction(
      {
        rows: [txRow()],
      },
      sessionAuth,
      { repository },
    ),
    401,
  );

  assertEquals(payload.error, "Import session expired or revoked");
});

Deno.test("applyRowsAction returns 404 when target batch does not exist", async () => {
  const { repository } = createRepositoryMock({ batchBefore: null });
  const payload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction(
      {
        rows: [txRow()],
        payer_person_id: "person-1",
        batch_id: "missing-batch",
      },
      userAuth,
      { repository },
    ),
    404,
  );
  assertEquals(payload.error, "Batch not found");
});

Deno.test(
  "applyRowsAction handles inserted/skipped/error rows and line-item branches",
  async () => {
    const { repository, state } = createRepositoryMock({
      batchBefore: {
        id: "batch-1",
        parsed_transactions_count: 5,
        inserted_count: 1,
        skipped_count: 1,
        error_count: 1,
      },
    });

    const payload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ status: string }>;
    }>(
      await applyRowsAction(
        {
          payer_person_id: "person-1",
          source: "tbank_web",
          rows: [
            txRow({
              external_id: "ok-1",
              line_items: [{ title: "ok" }, { title: "dup" }, { title: "err" }],
            }),
            txRow({ external_id: "dup-tx" }),
            txRow({ posted_at: "bad-date" }),
          ],
        },
        userAuth,
        {
          repository,
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
      ),
      200,
    );

    assertEquals(payload.inserted, 1);
    assertEquals(payload.skipped, 1);
    assertEquals(payload.error_count, 2);
    assertEquals(payload.row_results.length, 3);
    assertEquals(payload.row_results[0].status, "inserted");
    assertEquals(payload.row_results[1].status, "skipped");
    assertEquals(payload.row_results[2].status, "error");
    assertEquals(state.batchUpdates.length, 1);
    assertEquals(state.batchUpdates[0].patch.status, "completed");
  },
);

Deno.test("applyRowsAction runs session flow and keeps batch status running", async () => {
  const { repository, state } = createRepositoryMock();
  const sessionAuth: AuthContext = {
    mode: "session",
    token: "session-token",
    session: {
      id: "session-1",
      batch_id: "batch-1",
      source: "tbank_web",
      payer_person_id: "person-1",
      status: "created",
      revoked_at: null,
      expires_at: "2999-01-01T00:00:00.000Z",
    },
  };

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
  }>(
    await applyRowsAction(
      {
        rows: [txRow({ external_id: "ok-1" })],
      },
      sessionAuth,
      {
        repository,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    ),
    200,
  );

  assertEquals(payload.inserted, 1);
  assertEquals(payload.skipped, 0);
  assertEquals(payload.error_count, 0);
  assertEquals(state.sessionUpdates.length >= 2, true);
  assertEquals(state.batchUpdates[0].patch.status, "running");
});

Deno.test("applyRowsAction returns 400 when batch update fails", async () => {
  const { repository } = createRepositoryMock({ updateBatchError: "update failed" });
  const payload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction(
      {
        rows: [txRow()],
        payer_person_id: "person-1",
      },
      userAuth,
      { repository },
    ),
    400,
  );
  assertEquals(payload.error, "update failed");
});
