// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { discardBatchAction } from "./discard-batch.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext } from "./types.ts";

const userAuth: AuthContext = {
  mode: "user",
  token: "token",
  userId: "user-1",
  email: "user@example.com",
};

function createRepositoryMock(batch: Record<string, unknown> | null): {
  repository: MoneyImportRepository;
  updates: Array<{ batchId: string; patch: Record<string, unknown> }>;
} {
  const updates: Array<{ batchId: string; patch: Record<string, unknown> }> = [];

  return {
    repository: {
      authenticateAllowedUser: async () => null,
      getSessionByToken: async () => null,
      findLastImportedAt: async () => null,
      createImportSession: async () => ({ id: "session-1" }),
      getImportSessionForUser: async () => null,
      getImportSessionById: async () => null,
      updateImportSession: async () => {},
      createImportBatch: async () => "batch-1",
      getImportBatch: async () => batch,
      updateImportBatch: async (batchId, patch) => {
        updates.push({ batchId, patch });
      },
      getExistingTransactionStates: async () => [],
      listReportRowsByBatch: async () => [],
      deleteReportRowsByBatch: async () => {},
      resolveAccountIdForRow: async () => {
        throw new Error("unused");
      },
      resolveCardIdForRow: async () => {
        throw new Error("unused");
      },
      findExistingTransactionId: async () => null,
      findExistingLineItemId: async () => null,
      repairExistingTransactionDetails: async () => ({
        replaced_synthetic_line_items: false,
        has_only_synthetic_line_items: false,
        has_real_line_items: false,
        blocked_by_manual_edit: false,
      }),
      insertOrResolveTransaction: async () => {
        throw new Error("unused");
      },
      insertLineItemIfNew: async () => {
        throw new Error("unused");
      },
      insertReportRow: async () => {
        throw new Error("unused");
      },
    },
    updates,
  };
}

Deno.test("discardBatchAction validates batch id and auth", async () => {
  const { repository } = createRepositoryMock(null);

  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await discardBatchAction({}, userAuth, { repository }),
        400,
      )
    ).error,
    "batch_id is required",
  );

  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await discardBatchAction(
          { batch_id: "batch-1" },
          { mode: "session", token: "token", session: { id: "session-1" } },
          { repository },
        ),
        401,
      )
    ).error,
    "Unauthorized",
  );
});

Deno.test("discardBatchAction rejects missing and non-pending batches", async () => {
  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await discardBatchAction({ batch_id: "batch-1" }, userAuth, {
          repository: createRepositoryMock(null).repository,
        }),
        404,
      )
    ).error,
    "Batch not found",
  );

  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await discardBatchAction({ batch_id: "batch-1" }, userAuth, {
          repository: createRepositoryMock({ id: "batch-1", status: "completed" }).repository,
        }),
        409,
      )
    ).error,
    "Batch is not awaiting review",
  );
});

Deno.test("discardBatchAction marks pending batches discarded", async () => {
  const { repository, updates } = createRepositoryMock({
    id: "batch-1",
    status: "pending",
  });

  const payload = await assertJsonResponse<{ batch_id: string; status: string }>(
    await discardBatchAction({ batch_id: "batch-1" }, userAuth, {
      repository,
      now: () => new Date("2026-03-08T00:00:00.000Z"),
    }),
    200,
  );

  assertEquals(payload, {
    batch_id: "batch-1",
    status: "discarded",
  });
  assertEquals(updates, [
    {
      batchId: "batch-1",
      patch: {
        status: "discarded",
        completed_at: "2026-03-08T00:00:00.000Z",
      },
    },
  ]);
});
