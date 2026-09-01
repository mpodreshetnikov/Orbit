// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { updateBrandResolutionAction } from "./update-brand-resolution.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext } from "./types.ts";

const userAuth: AuthContext = {
  mode: "user",
  token: "token",
  userId: "user-1",
  email: "user@example.com",
};

function createRepositoryMock(
  options: {
    resolution?: Record<string, unknown> | null;
    batch?: Record<string, unknown> | null;
  } = {},
): MoneyImportRepository {
  return {
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
    getImportBatch: async () => options.batch ?? null,
    updateImportBatch: async () => {},
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
    getBatchBrandResolutionById: async () => options.resolution ?? null,
    updateBatchBrandResolutionSelection: async () => {},
  };
}

Deno.test("updateBrandResolutionAction validates request payload and auth", async () => {
  const repository = createRepositoryMock();

  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await updateBrandResolutionAction({}, userAuth, { repository }),
        400,
      )
    ).error,
    "resolution_id is required",
  );

  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await updateBrandResolutionAction(
          {
            resolution_id: "resolution-1",
          },
          { mode: "session", token: "token", session: { id: "session-1" } },
          { repository },
        ),
        401,
      )
    ).error,
    "Unauthorized",
  );

  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await updateBrandResolutionAction(
          {
            resolution_id: "resolution-1",
            selected_action: "bad-value",
          },
          userAuth,
          { repository },
        ),
        400,
      )
    ).error,
    "selected_action is required",
  );

  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await updateBrandResolutionAction(
          {
            resolution_id: "resolution-1",
            selected_action: "match_existing",
          },
          userAuth,
          { repository },
        ),
        400,
      )
    ).error,
    "selected_brand_id is required",
  );
});

Deno.test(
  "updateBrandResolutionAction rejects missing resolution, batch, and non-pending states",
  async () => {
    assertEquals(
      (
        await assertJsonResponse<{ error: string }>(
          await updateBrandResolutionAction(
            {
              resolution_id: "missing",
              selected_action: "create_new",
            },
            userAuth,
            { repository: createRepositoryMock({ resolution: null }) },
          ),
          404,
        )
      ).error,
      "Brand resolution not found",
    );

    assertEquals(
      (
        await assertJsonResponse<{ error: string }>(
          await updateBrandResolutionAction(
            {
              resolution_id: "resolution-1",
              selected_action: "create_new",
            },
            userAuth,
            {
              repository: createRepositoryMock({
                resolution: { id: "resolution-1", batch_id: null },
              }),
            },
          ),
          400,
        )
      ).error,
      "Brand resolution batch is missing",
    );

    assertEquals(
      (
        await assertJsonResponse<{ error: string }>(
          await updateBrandResolutionAction(
            {
              resolution_id: "resolution-1",
              selected_action: "create_new",
            },
            userAuth,
            {
              repository: createRepositoryMock({
                resolution: { id: "resolution-1", batch_id: "batch-1" },
                batch: null,
              }),
            },
          ),
          404,
        )
      ).error,
      "Batch not found",
    );

    assertEquals(
      (
        await assertJsonResponse<{ error: string }>(
          await updateBrandResolutionAction(
            {
              resolution_id: "resolution-1",
              selected_action: "create_new",
            },
            userAuth,
            {
              repository: createRepositoryMock({
                resolution: { id: "resolution-1", batch_id: "batch-1" },
                batch: { id: "batch-1", status: "completed" },
              }),
            },
          ),
          409,
        )
      ).error,
      "Batch is not awaiting review",
    );
  },
);

Deno.test("updateBrandResolutionAction persists both match and create selections", async () => {
  const updates: Array<{
    resolutionId: string;
    selectedAction: string;
    selectedBrandId: string | null;
  }> = [];
  const repository: MoneyImportRepository = {
    ...createRepositoryMock({
      resolution: { id: "resolution-1", batch_id: "batch-1" },
      batch: { id: "batch-1", status: "pending" },
    }),
    updateBatchBrandResolutionSelection: async (resolutionId, selectedAction, selectedBrandId) => {
      updates.push({ resolutionId, selectedAction, selectedBrandId });
    },
  };

  const matchPayload = await assertJsonResponse<{
    resolution_id: string;
    selected_action: string;
    selected_brand_id: string | null;
  }>(
    await updateBrandResolutionAction(
      {
        resolution_id: "resolution-1",
        selected_action: "match_existing",
        selected_brand_id: "brand-1",
      },
      userAuth,
      { repository },
    ),
    200,
  );
  assertEquals(matchPayload, {
    resolution_id: "resolution-1",
    selected_action: "match_existing",
    selected_brand_id: "brand-1",
  });

  const createPayload = await assertJsonResponse<{
    resolution_id: string;
    selected_action: string;
    selected_brand_id: string | null;
  }>(
    await updateBrandResolutionAction(
      {
        resolution_id: "resolution-1",
        selected_action: "create_new",
      },
      userAuth,
      { repository },
    ),
    200,
  );
  assertEquals(createPayload, {
    resolution_id: "resolution-1",
    selected_action: "create_new",
    selected_brand_id: null,
  });

  assertEquals(updates, [
    {
      resolutionId: "resolution-1",
      selectedAction: "match_existing",
      selectedBrandId: "brand-1",
    },
    {
      resolutionId: "resolution-1",
      selectedAction: "create_new",
      selectedBrandId: null,
    },
  ]);
});
