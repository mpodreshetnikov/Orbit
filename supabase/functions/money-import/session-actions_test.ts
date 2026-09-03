// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import {
  completeSessionAction,
  createSessionAction,
  getImportContextAction,
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
    getGrantByToken: async () => null,
    getGrantById: async () => null,
    isAuthUserAllowed: async () => false,
    markGrantUsed: async () => {},
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

Deno.test("createSessionAction gives a session the time its receipt strategy needs", async () => {
  const deps = {
    now: () => new Date("2026-01-01T10:00:00.000Z"),
    sessionTtlMinutes: 30,
  };

  // Fast, or no strategy stated: the configured base.
  const fast = createRepositoryMock();
  const fastPayload = await assertJsonResponse<{ ttl_minutes: number; expires_at: string }>(
    await createSessionAction(
      { source: "tbank_web", payer_person_id: "person-1", meta: { parse_strategy: "fast" } },
      userAuth,
      { repository: fast.repository, ...deps },
    ),
    200,
  );
  assertEquals(fastPayload.ttl_minutes, 30);
  assertEquals(fastPayload.expires_at, "2026-01-01T10:30:00.000Z");

  // Full: about eight seconds a receipt, and preview_rows only after the whole parse. Fifteen
  // minutes lost every such run of a month or more.
  const full = createRepositoryMock();
  const fullPayload = await assertJsonResponse<{ ttl_minutes: number; expires_at: string }>(
    await createSessionAction(
      {
        source: "tbank_web",
        payer_person_id: "person-1",
        meta: { parse_strategy: "full", unattended: true },
      },
      userAuth,
      { repository: full.repository, ...deps },
    ),
    200,
  );
  assertEquals(fullPayload.ttl_minutes, 240);
  assertEquals(fullPayload.expires_at, "2026-01-01T14:00:00.000Z");
  assertEquals(
    full.state.createdSessionPayloads[0]?.expires_at as string | undefined,
    "2026-01-01T14:00:00.000Z",
  );
});

Deno.test("createSessionAction creates session and batch and returns token payload", async () => {
  const { repository, state } = createRepositoryMock({
    lastImportedAt: "2026-01-01T00:00:00.000Z",
  });

  const response = await createSessionAction(
    {
      source: "tbank_web",
      payer_person_id: "person-1",
      meta: { from: "test", parse_strategy: "full" },
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
    parse_strategy: string | null;
  }>(response, 200);

  assertEquals(payload.session_id, "session-1");
  assertEquals(payload.batch_id, "batch-1");
  // The full strategy earns the long session; the configured base is only a floor.
  assertEquals(payload.ttl_minutes, 240);
  assertEquals(payload.last_imported_at, "2026-01-01T00:00:00.000Z");
  assertEquals(payload.parse_strategy, "full");
  assertEquals(typeof payload.session_token, "string");
  assertEquals(payload.session_token.length > 10, true);
  assertEquals(state.createdSessionPayloads.length, 1);
  assertEquals(state.createdBatchPayloads.length, 1);
  assertEquals(state.sessionUpdates.length, 1);
  assertEquals(
    (state.createdSessionPayloads[0]?.meta as Record<string, unknown> | undefined)?.parse_strategy,
    "full",
  );
  assertEquals(
    (state.createdBatchPayloads[0]?.meta as Record<string, unknown> | undefined)?.parse_strategy,
    "full",
  );
});

Deno.test("getImportContextAction returns auto mode for recent source history", async () => {
  const { repository } = createRepositoryMock({
    lastImportedAt: "2026-02-20T12:00:00.000Z",
  });

  const payload = await assertJsonResponse<{
    last_imported_at: string | null;
    requires_history_prompt: boolean;
    stale_threshold_days: number;
    recommended_mode: string;
    window_from: string | null;
    window_to: string | null;
  }>(
    await getImportContextAction(
      {
        source: "tbank_web",
        payer_person_id: "person-1",
      },
      userAuth,
      {
        repository,
        now: () => new Date("2026-03-08T00:00:00.000Z"),
      },
    ),
    200,
  );

  assertEquals(payload.last_imported_at, "2026-02-20T12:00:00.000Z");
  assertEquals(payload.requires_history_prompt, false);
  assertEquals(payload.stale_threshold_days, 365);
  assertEquals(payload.recommended_mode, "auto");
  assertEquals(payload.window_from, "2026-02-20T12:00:00.000Z");
  assertEquals(payload.window_to, "2026-03-08T00:00:00.000Z");
});

Deno.test(
  "getImportContextAction prompts for one-year history when source has no imports",
  async () => {
    const { repository } = createRepositoryMock({
      lastImportedAt: null,
    });

    const payload = await assertJsonResponse<{
      last_imported_at: string | null;
      requires_history_prompt: boolean;
      stale_threshold_days: number;
      recommended_mode: string;
      window_from: string | null;
      window_to: string | null;
    }>(
      await getImportContextAction(
        {
          source: "tbank_web",
          payer_person_id: "person-1",
        },
        userAuth,
        {
          repository,
          now: () => new Date("2026-03-08T00:00:00.000Z"),
        },
      ),
      200,
    );

    assertEquals(payload.last_imported_at, null);
    assertEquals(payload.requires_history_prompt, true);
    assertEquals(payload.stale_threshold_days, 365);
    assertEquals(payload.recommended_mode, "preset");
    assertEquals(payload.window_from, "2025-03-08T00:00:00.000Z");
    assertEquals(payload.window_to, "2026-03-08T00:00:00.000Z");
  },
);

Deno.test(
  "getImportContextAction prompts for one-year history when last import is stale",
  async () => {
    const { repository } = createRepositoryMock({
      lastImportedAt: "2024-01-15T09:00:00.000Z",
    });

    const payload = await assertJsonResponse<{
      last_imported_at: string | null;
      requires_history_prompt: boolean;
      stale_threshold_days: number;
      recommended_mode: string;
      window_from: string | null;
      window_to: string | null;
    }>(
      await getImportContextAction(
        {
          source: "tbank_web",
          payer_person_id: "person-1",
        },
        userAuth,
        {
          repository,
          now: () => new Date("2026-03-08T00:00:00.000Z"),
        },
      ),
      200,
    );

    assertEquals(payload.last_imported_at, "2024-01-15T09:00:00.000Z");
    assertEquals(payload.requires_history_prompt, true);
    assertEquals(payload.stale_threshold_days, 365);
    assertEquals(payload.recommended_mode, "preset");
    assertEquals(payload.window_from, "2025-03-08T00:00:00.000Z");
    assertEquals(payload.window_to, "2026-03-08T00:00:00.000Z");
  },
);

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

Deno.test("completeSessionAction does not fail a batch that has already been applied", async () => {
  const { repository, state } = createRepositoryMock({
    sessionForUser: { id: "session-1", batch_id: "batch-1" },
    batchById: { id: "batch-1", status: "completed" },
  });

  await assertJsonResponse(
    await completeSessionAction({ session_id: "session-1", status: "failed" }, userAuth, {
      repository,
      now: () => new Date("2026-01-01T10:00:00.000Z"),
    }),
    200,
  );

  // The session is closed as asked; the batch keeps its result and only gains a timestamp.
  const batchUpdates = state.batchUpdates.map((update) => update.patch);
  assertEquals(
    batchUpdates.some((patch) => patch.status === "failed"),
    false,
  );
  assertEquals(batchUpdates.at(-1)?.completed_at, "2026-01-01T10:00:00.000Z");
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

const grantAuth: AuthContext = {
  mode: "grant",
  token: "grant-token",
  grant: {
    id: "grant-1",
    person_id: "person-grant",
    created_by_auth_user_id: "user-grant",
    allowed_sources: ["tbank_web"],
    revoked_at: null,
    expires_at: null,
  },
};

Deno.test("createSessionAction starts a session from a grant", async () => {
  const { repository, state } = createRepositoryMock({});
  const markedGrants: Array<{ grantId: string; usedAtIso: string }> = [];
  repository.markGrantUsed = async (grantId, usedAtIso) => {
    markedGrants.push({ grantId, usedAtIso });
  };

  const response = await createSessionAction(
    {
      source: "tbank_web",
      // A grant fixes the payer; a payer named in the body must not override it.
      payer_person_id: "person-somebody-else",
      window_from: "2026-07-20T12:00:00.000Z",
      window_to: "2026-08-20T12:00:00.000Z",
    },
    grantAuth,
    { repository, now: () => new Date("2026-08-23T10:00:00.000Z") },
  );

  const payload = await assertJsonResponse<{ payer_person_id: string }>(response, 200);
  assertEquals(payload.payer_person_id, "person-grant");
  assertEquals(state.createdSessionPayloads[0]?.payer_person_id, "person-grant");
  assertEquals(state.createdSessionPayloads[0]?.created_by_auth_user_id, "user-grant");
  assertEquals(markedGrants, [{ grantId: "grant-1", usedAtIso: "2026-08-23T10:00:00.000Z" }]);
});

Deno.test("createSessionAction refuses a source outside the grant", async () => {
  const { repository } = createRepositoryMock({});

  const response = await createSessionAction({ source: "alfa_web" }, grantAuth, {
    repository,
    now: () => new Date("2026-08-23T10:00:00.000Z"),
  });

  assertEquals(await assertJsonResponse(response, 403), {
    error: "Source is not allowed for this grant",
  });
});
