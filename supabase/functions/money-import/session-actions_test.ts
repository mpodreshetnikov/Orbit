// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import {
  completeSessionAction,
  createSessionAction,
  sessionStatusAction,
} from "./session-actions.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext, UserAuthContext } from "./types.ts";

interface SessionRepoState {
  createdSessionPayloads: Record<string, unknown>[];
  createdBatchPayloads: Record<string, unknown>[];
  sessionUpdates: Array<{ sessionId: string; patch: Record<string, unknown> }>;
  batchUpdates: Array<{ batchId: string; patch: Record<string, unknown> }>;
}

function createRepositoryMock(
  options: {
    sessionForUser?: Record<string, unknown> | null;
    batchById?: Record<string, unknown> | null;
    lastImportedAt?: string | null;
  } = {},
): { repository: MoneyImportRepository; state: SessionRepoState } {
  const state: SessionRepoState = {
    createdSessionPayloads: [],
    createdBatchPayloads: [],
    sessionUpdates: [],
    batchUpdates: [],
  };

  const repository: MoneyImportRepository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    findLastImportedAt: async () => options.lastImportedAt ?? null,
    createImportSession: async (payload) => {
      state.createdSessionPayloads.push(payload);
      return { id: "session-1" };
    },
    getImportSessionForUser: async () => options.sessionForUser ?? null,
    getImportSessionById: async () => options.sessionForUser ?? null,
    updateImportSession: async (sessionId, patch) => {
      state.sessionUpdates.push({ sessionId, patch });
    },
    createImportBatch: async (payload) => {
      state.createdBatchPayloads.push(payload);
      return "batch-1";
    },
    getImportBatch: async () => options.batchById ?? null,
    updateImportBatch: async (batchId, patch) => {
      state.batchUpdates.push({ batchId, patch });
    },
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
    insertOrResolveTransaction: async () => {
      throw new Error("unused");
    },
    insertLineItemIfNew: async () => {
      throw new Error("unused");
    },
    insertReportRow: async () => {
      throw new Error("unused");
    },
  };

  return { repository, state };
}

const userAuth: UserAuthContext = {
  mode: "user",
  token: "token",
  userId: "user-1",
  email: "user@example.com",
};

Deno.test("createSessionAction validates required source and payer_person_id", async () => {
  const { repository } = createRepositoryMock();
  const response = await createSessionAction({}, userAuth, { repository });
  const payload = await assertJsonResponse<{ error: string }>(response, 400);
  assertEquals(payload.error, "source and payer_person_id are required");
});

Deno.test("createSessionAction creates session and batch and returns token payload", async () => {
  const { repository, state } = createRepositoryMock({
    lastImportedAt: "2026-01-01T00:00:00.000Z",
  });

  const response = await createSessionAction(
    {
      source: "tbank_web",
      payer_person_id: "person-1",
      meta: { from: "test" },
      window_from: "2026-01-01",
      window_to: "2026-01-31",
    },
    userAuth,
    {
      repository,
      now: () => new Date("2026-01-01T10:00:00.000Z"),
      sessionTtlMinutes: 30,
    },
  );

  const payload = await assertJsonResponse<{
    session_id: string;
    session_token: string;
    batch_id: string;
    ttl_minutes: number;
    last_imported_at: string | null;
  }>(response, 200);

  assertEquals(payload.session_id, "session-1");
  assertEquals(payload.batch_id, "batch-1");
  assertEquals(payload.ttl_minutes, 30);
  assertEquals(payload.last_imported_at, "2026-01-01T00:00:00.000Z");
  assertEquals(typeof payload.session_token, "string");
  assertEquals(payload.session_token.length > 10, true);
  assertEquals(state.createdSessionPayloads.length, 1);
  assertEquals(state.createdBatchPayloads.length, 1);
  assertEquals(state.sessionUpdates.length, 1);
});

Deno.test("sessionStatusAction returns 404 for unknown session", async () => {
  const { repository } = createRepositoryMock({ sessionForUser: null });
  const response = await sessionStatusAction({ session_id: "missing" }, userAuth, { repository });
  const payload = await assertJsonResponse<{ error: string }>(response, 404);
  assertEquals(payload.error, "Session not found");
});

Deno.test("sessionStatusAction returns session and batch progress payload", async () => {
  const { repository } = createRepositoryMock({
    sessionForUser: {
      id: "session-1",
      source: "tbank",
      payer_person_id: "person-1",
      status: "running",
      expires_at: "2026-01-01T00:15:00.000Z",
      revoked_at: null,
      batch_id: "batch-1",
      window_from: "2026-01-01T00:00:00.000Z",
      window_to: "2026-01-11T00:00:00.000Z",
    },
    batchById: {
      id: "batch-1",
      status: "running",
      parsed_transactions_count: 10,
      parsed_through_at: "2026-01-06T00:00:00.000Z",
      inserted_count: 7,
      skipped_count: 2,
      error_count: 1,
      completed_at: null,
      window_from: "2026-01-01T00:00:00.000Z",
      window_to: "2026-01-11T00:00:00.000Z",
    },
  });

  const payload = await assertJsonResponse<{
    batch: { progress_percent: number | null } | null;
    session: { batch_id: string | null };
  }>(await sessionStatusAction({ session_id: "session-1" }, userAuth, { repository }), 200);

  assertEquals(payload.session.batch_id, "batch-1");
  assertEquals(payload.batch?.progress_percent, 50);
});

Deno.test(
  "sessionStatusAction validates session_id and supports sessions without batches",
  async () => {
    const missingSessionIdRepo = createRepositoryMock();
    const missingSessionId = await assertJsonResponse<{ error: string }>(
      await sessionStatusAction({}, userAuth, { repository: missingSessionIdRepo.repository }),
      400,
    );
    assertEquals(missingSessionId.error, "session_id is required");

    const { repository } = createRepositoryMock({
      sessionForUser: {
        id: "session-no-batch",
        source: "manual",
        payer_person_id: "person-1",
        status: "running",
        expires_at: "2026-01-01T00:15:00.000Z",
        revoked_at: null,
        batch_id: null,
        window_from: "2026-01-01T00:00:00.000Z",
        window_to: "2026-01-11T00:00:00.000Z",
      },
      batchById: null,
    });

    const payload = await assertJsonResponse<{
      session: { batch_id: string | null };
      batch: Record<string, unknown> | null;
    }>(
      await sessionStatusAction({ session_id: "session-no-batch" }, userAuth, { repository }),
      200,
    );

    assertEquals(payload.session.batch_id, null);
    assertEquals(payload.batch, null);
  },
);

Deno.test("completeSessionAction validates ownership for user auth", async () => {
  const { repository } = createRepositoryMock({ sessionForUser: null });
  const response = await completeSessionAction({ session_id: "session-1" }, userAuth, {
    repository,
  });
  const payload = await assertJsonResponse<{ error: string }>(response, 404);
  assertEquals(payload.error, "Session not found");
});

Deno.test("completeSessionAction updates session and leaves pending batch untouched", async () => {
  const { repository, state } = createRepositoryMock({
    sessionForUser: {
      id: "session-1",
      batch_id: "batch-1",
    },
    batchById: {
      id: "batch-1",
      status: "pending",
    },
  });

  const payload = await assertJsonResponse<{ status: string }>(
    await completeSessionAction(
      {
        session_id: "session-1",
      },
      userAuth,
      {
        repository,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    ),
    200,
  );

  assertEquals(payload.status, "completed");
  assertEquals(state.sessionUpdates.length, 1);
  assertEquals(state.batchUpdates.length, 0);
});

Deno.test("completeSessionAction supports session auth and failed status", async () => {
  const { repository, state } = createRepositoryMock({
    batchById: {
      id: "batch-2",
      status: "running",
    },
  });
  const auth: AuthContext = {
    mode: "session",
    token: "session-token",
    session: {
      id: "session-2",
      batch_id: "batch-2",
    },
  };

  const payload = await assertJsonResponse<{ session_id: string; status: string }>(
    await completeSessionAction(
      {
        status: "failed",
      },
      auth,
      {
        repository,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    ),
    200,
  );

  assertEquals(payload.session_id, "session-2");
  assertEquals(payload.status, "failed");
  assertEquals(state.sessionUpdates[0].patch.status, "failed");
  assertEquals(state.batchUpdates[0].patch.status, "failed");
});

Deno.test(
  "completeSessionAction validates missing session id and fallbacks for session auth",
  async () => {
    const missingUserSessionId = createRepositoryMock({
      sessionForUser: null,
    });
    const missingUserPayload = await assertJsonResponse<{ error: string }>(
      await completeSessionAction({}, userAuth, { repository: missingUserSessionId.repository }),
      400,
    );
    assertEquals(missingUserPayload.error, "session_id is required");

    const { repository, state } = createRepositoryMock({
      batchById: {
        id: "batch-from-body",
        status: "pending",
      },
    });
    const auth: AuthContext = {
      mode: "session",
      token: "session-token",
      session: {},
    };

    const payload = await assertJsonResponse<{
      session_id: string;
      batch_id: string;
      status: string;
    }>(
      await completeSessionAction(
        {
          session_id: "session-from-body",
          batch_id: "batch-from-body",
        },
        auth,
        {
          repository,
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
      ),
      200,
    );

    assertEquals(payload.session_id, "session-from-body");
    assertEquals(payload.batch_id, "batch-from-body");
    assertEquals(payload.status, "completed");
    assertEquals(state.sessionUpdates.length, 1);
    assertEquals(state.batchUpdates.length, 0);
  },
);
