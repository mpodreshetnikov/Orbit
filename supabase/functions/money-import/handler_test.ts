// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "../_shared/cors.ts";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { createMoneyImportHandler } from "./handler.ts";
import type { MoneyImportRepository } from "./repository.ts";

Deno.env.set("OBS_LOCAL_OTLP_HTTP_ENDPOINT", "");

function createRepositoryMock(
  options: {
    sessionForUser?: Record<string, unknown> | null;
    sessionByToken?: Record<string, unknown> | null;
    grantByToken?: Record<string, unknown> | null;
    issuerIsAllowed?: boolean;
  } = {},
): MoneyImportRepository {
  return {
    authenticateAllowedUser: async (token: string) => {
      if (token !== "user-token") return null;
      return {
        mode: "user",
        token,
        userId: "user-1",
        email: "user@example.com",
      };
    },
    getSessionByToken: async (token: string) => {
      if (token !== "session-token") return null;
      return (
        options.sessionByToken ?? {
          id: "session-1",
          batch_id: "batch-1",
          source: "tbank_web",
          payer_person_id: "person-1",
          status: "running",
          revoked_at: null,
          expires_at: "2999-01-01T00:00:00.000Z",
        }
      );
    },
    findLastImportedAt: async () => null,
    createImportSession: async () => ({ id: "session-1" }),
    getGrantByToken: async (token: string) => {
      if (token !== "grant-token") return null;
      return options.grantByToken ?? null;
    },
    getGrantById: async () => options.grantByToken ?? null,
    isAuthUserAllowed: async () => options.issuerIsAllowed ?? true,
    markGrantUsed: async () => {},
    getImportSessionForUser: async () => options.sessionForUser ?? null,
    getImportSessionById: async () => options.sessionForUser ?? null,
    updateImportSession: async () => {},
    createImportBatch: async () => "batch-1",
    getImportBatch: async () => ({
      id: "batch-1",
      payer_person_id: "person-1",
      source: "tbank_web",
      import_type: "file",
      parsed_transactions_count: 0,
      inserted_count: 0,
      skipped_count: 0,
      error_count: 0,
      parsed_through_at: null,
      status: "pending",
    }),
    updateImportBatch: async () => {},
    listReportRowsByBatch: async () => [
      {
        id: "preview-row-1",
        row_kind: "transaction",
        payload: {
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: 10,
          currency: "RUB",
          transaction_type: "expense",
          status: "posted",
          source: "tbank_web",
          account_id: "acc-1",
          account_hint: "1234",
          card_id: "card-1",
          raw_payload: { account_hint: "**** 1234" },
          line_items: [],
        },
      },
    ],
    deleteReportRowsByBatch: async () => {},
    resolveAccountIdForRow: async () => "acc-1",
    resolveCardIdForRow: async () => "card-target",
    findExistingTransactionId: async () => null,
    findExistingLineItemId: async () => null,
    getExistingTransactionStates: async () => [],
    repairExistingTransactionDetails: async () => ({
      replaced_synthetic_line_items: false,
      has_only_synthetic_line_items: false,
      has_real_line_items: false,
    }),
    insertOrResolveTransaction: async () => ({ transactionId: "tx-1", inserted: true }),
    insertLineItemIfNew: async () => ({ lineItemId: "line-1", inserted: true }),
    insertReportRow: async () => "report-1",
    previewBrandResolutionForRow: async () => null,
    upsertBatchBrandResolution: async () => {},
    getBatchBrandResolutionById: async (resolutionId: string) => ({
      id: resolutionId,
      batch_id: "batch-1",
    }),
    listBatchBrandResolutions: async () => [],
    deleteBatchBrandResolutionsByBatch: async () => {},
    updateBatchBrandResolutionSelection: async () => {},
  };
}

Deno.test("money-import handler responds to OPTIONS", async () => {
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const response = await handler(
    new Request("http://localhost/functions/v1/money-import", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 200);
  await response.text();
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    corsHeaders["Access-Control-Allow-Origin"],
  );
});

Deno.test("money-import handler rejects non-POST methods", async () => {
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock(),
  });
  const payload = await assertJsonResponse<{ error: string }>(
    await handler(new Request("http://localhost/functions/v1/money-import", { method: "GET" })),
    405,
  );
  assertEquals(payload.error, "Method not allowed");
});

Deno.test("money-import handler validates action and unknown action branch", async () => {
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock(),
  });

  const missingAction = await assertJsonResponse<{ error: string }>(
    await handler(
      new Request("http://localhost/functions/v1/money-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    ),
    400,
  );
  assertEquals(missingAction.error, "action is required");

  const unknownAction = await assertJsonResponse<{ error: string }>(
    await handler(
      new Request("http://localhost/functions/v1/money-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unknown_action" }),
      }),
    ),
    400,
  );
  assertEquals(unknownAction.error, "Unknown action: unknown_action");
});

Deno.test("money-import handler returns 401 for missing auth on protected actions", async () => {
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock(),
  });
  const payload = await assertJsonResponse<{ error: string }>(
    await handler(
      new Request("http://localhost/functions/v1/money-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_session",
          source: "tbank",
          payer_person_id: "person-1",
        }),
      }),
    ),
    401,
  );
  assertEquals(payload.error, "Missing Authorization header");
});

Deno.test(
  "money-import handler runs get_existing_transaction_states for authenticated users",
  async () => {
    const handler = createMoneyImportHandler({
      repository: {
        ...createRepositoryMock(),
        getExistingTransactionStates: async () => [
          {
            transaction_id: "tx-1",
            exists: true,
            fulfilled: true,
            has_only_synthetic_line_items: false,
            has_real_line_items: true,
            receipt_enrichment_status: "ok",
          },
        ],
      },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const payload = await assertJsonResponse<{
      states: Array<Record<string, unknown>>;
    }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "get_existing_transaction_states",
            source: "tbank_web",
            payer_person_id: "person-1",
            candidates: [{ external_id: "ext-1", dedupe_hash: "hash-1" }],
          }),
        }),
      ),
      200,
    );

    assertEquals(payload.states, [
      {
        transaction_id: "tx-1",
        exists: true,
        fulfilled: true,
        has_only_synthetic_line_items: false,
        has_real_line_items: true,
        receipt_enrichment_status: "ok",
      },
    ]);
  },
);

Deno.test(
  "money-import handler returns validation errors for get_existing_transaction_states",
  async () => {
    const handler = createMoneyImportHandler({
      repository: createRepositoryMock(),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const payload = await assertJsonResponse<{ error: string }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "get_existing_transaction_states",
            source: "",
            payer_person_id: "person-1",
            candidates: [],
          }),
        }),
      ),
      400,
    );

    assertEquals(payload.error, "source and payer_person_id are required");
  },
);

Deno.test(
  "money-import handler runs create_session, preview_rows, apply_batch, discard_batch, and update_brand_resolution happy paths",
  async () => {
    const handler = createMoneyImportHandler({
      repository: createRepositoryMock({
        sessionForUser: {
          id: "session-1",
          source: "tbank",
          payer_person_id: "person-1",
          status: "running",
          expires_at: "2999-01-01T00:00:00.000Z",
          revoked_at: null,
          batch_id: "batch-1",
        },
      }),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const createSessionPayload = await assertJsonResponse<{ session_id: string; batch_id: string }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "create_session",
            source: "tbank",
            payer_person_id: "person-1",
          }),
        }),
      ),
      200,
    );
    assertEquals(createSessionPayload.session_id, "session-1");
    assertEquals(createSessionPayload.batch_id, "batch-1");

    const previewRowsPayload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
    }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer session-token",
          },
          body: JSON.stringify({
            action: "preview_rows",
            rows: [
              {
                posted_at: "2026-01-01T00:00:00.000Z",
                amount: 10,
                transaction_type: "expense",
              },
            ],
          }),
        }),
      ),
      200,
    );
    assertEquals(previewRowsPayload.inserted, 1);
    assertEquals(previewRowsPayload.skipped, 0);
    assertEquals(previewRowsPayload.error_count, 0);

    const applyBatchPayload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
    }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "apply_batch",
            batch_id: "batch-1",
          }),
        }),
      ),
      200,
    );
    assertEquals(applyBatchPayload.inserted, 1);
    assertEquals(applyBatchPayload.skipped, 0);
    assertEquals(applyBatchPayload.error_count, 0);

    const discardBatchPayload = await assertJsonResponse<{ batch_id: string; status: string }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "discard_batch",
            batch_id: "batch-1",
          }),
        }),
      ),
      200,
    );
    assertEquals(discardBatchPayload.batch_id, "batch-1");
    assertEquals(discardBatchPayload.status, "discarded");

    const updateBrandResolutionPayload = await assertJsonResponse<{
      resolution_id: string;
      selected_action: string;
      selected_brand_id: string | null;
    }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "update_brand_resolution",
            resolution_id: "resolution-1",
            selected_action: "match_existing",
            selected_brand_id: "brand-1",
          }),
        }),
      ),
      200,
    );
    assertEquals(updateBrandResolutionPayload.resolution_id, "resolution-1");
    assertEquals(updateBrandResolutionPayload.selected_action, "match_existing");
    assertEquals(updateBrandResolutionPayload.selected_brand_id, "brand-1");
  },
);

Deno.test("money-import handler runs remap_preview_card for authenticated users", async () => {
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  const payload = await assertJsonResponse<{
    batch_id: string;
    previous_card_id: string;
    resulting_card_id: string;
    target_account_id: string;
    updated_row_count: number;
  }>(
    await handler(
      new Request("http://localhost/functions/v1/money-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-token",
        },
        body: JSON.stringify({
          action: "remap_preview_card",
          batch_id: "batch-1",
          card_id: "card-1",
          target_account_id: "acc-2",
        }),
      }),
    ),
    200,
  );

  assertEquals(payload.batch_id, "batch-1");
  assertEquals(payload.previous_card_id, "card-1");
  assertEquals(payload.resulting_card_id, "card-target");
  assertEquals(payload.target_account_id, "acc-2");
  assertEquals(payload.updated_row_count, 1);
});

Deno.test(
  "money-import handler returns existing transaction states for authenticated users",
  async () => {
    const repository = createRepositoryMock();
    repository.getExistingTransactionStates = async () => [
      {
        transaction_id: "tx-1",
        exists: true,
        fulfilled: false,
        has_only_synthetic_line_items: true,
        has_real_line_items: false,
        receipt_enrichment_status: "ok",
      },
    ];

    const handler = createMoneyImportHandler({
      repository,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const payload = await assertJsonResponse<{
      states: Array<{ transaction_id: string | null; fulfilled: boolean }>;
    }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "get_existing_transaction_states",
            source: "tbank_web",
            payer_person_id: "person-1",
            candidates: [
              {
                external_id: "ext-1",
                dedupe_hash: "hash-1",
                posted_at: "2026-01-01T00:00:00.000Z",
                amount: 10,
              },
            ],
          }),
        }),
      ),
      200,
    );

    assertEquals(payload.states[0].transaction_id, "tx-1");
    assertEquals(payload.states[0].fulfilled, false);
  },
);

Deno.test("money-import handler runs get_import_context for authenticated users", async () => {
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock({
      sessionForUser: {
        id: "session-1",
        source: "tbank_web",
        payer_person_id: "person-1",
        status: "running",
        expires_at: "2999-01-01T00:00:00.000Z",
        revoked_at: null,
        batch_id: "batch-1",
      },
    }),
    now: () => new Date("2026-03-08T00:00:00.000Z"),
  });

  const payload = await assertJsonResponse<{
    requires_history_prompt: boolean;
    stale_threshold_days: number;
    recommended_mode: string;
    window_to: string | null;
  }>(
    await handler(
      new Request("http://localhost/functions/v1/money-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-token",
        },
        body: JSON.stringify({
          action: "get_import_context",
          source: "tbank_web",
          payer_person_id: "person-1",
        }),
      }),
    ),
    200,
  );

  assertEquals(payload.requires_history_prompt, true);
  assertEquals(payload.stale_threshold_days, 365);
  assertEquals(payload.recommended_mode, "preset");
  assertEquals(payload.window_to, "2026-03-08T00:00:00.000Z");
});

Deno.test(
  "money-import handler returns session_status and complete_session errors for unknown session",
  async () => {
    const handler = createMoneyImportHandler({
      repository: createRepositoryMock({ sessionForUser: null }),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const statusPayload = await assertJsonResponse<{ error: string }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "session_status",
            session_id: "missing",
          }),
        }),
      ),
      404,
    );
    assertEquals(statusPayload.error, "Session not found");

    const completePayload = await assertJsonResponse<{ error: string }>(
      await handler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "complete_session",
            session_id: "missing",
          }),
        }),
      ),
      404,
    );
    assertEquals(completePayload.error, "Session not found");
  },
);

Deno.test("money-import handler handles malformed json and non-object body", async () => {
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock(),
  });

  const malformed = await assertJsonResponse<{ error: string }>(
    await handler(
      new Request("http://localhost/functions/v1/money-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-token",
        },
        body: "{bad-json",
      }),
    ),
    400,
  );
  assertEquals(malformed.error, "action is required");

  const nonObject = await assertJsonResponse<{ error: string }>(
    await handler(
      new Request("http://localhost/functions/v1/money-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-token",
        },
        body: JSON.stringify("not-an-object"),
      }),
    ),
    400,
  );
  assertEquals(nonObject.error, "action is required");
});

Deno.test(
  "money-import handler maps Unauthorized and generic errors from auth resolution",
  async () => {
    const unauthorizedHandler = createMoneyImportHandler({
      repository: createRepositoryMock(),
    });

    const unauthorized = await assertJsonResponse<{ error: string }>(
      await unauthorizedHandler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer invalid-token",
          },
          body: JSON.stringify({
            action: "create_session",
            source: "tbank",
            payer_person_id: "person-1",
          }),
        }),
      ),
      401,
    );
    assertEquals(unauthorized.error, "Unauthorized");

    const genericErrorHandler = createMoneyImportHandler({
      repository: {
        ...createRepositoryMock(),
        authenticateAllowedUser: async () => {
          throw new Error("Auth backend exploded");
        },
      },
    });

    const generic = await assertJsonResponse<{ error: string }>(
      await genericErrorHandler(
        new Request("http://localhost/functions/v1/money-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer user-token",
          },
          body: JSON.stringify({
            action: "create_session",
            source: "tbank",
            payer_person_id: "person-1",
          }),
        }),
      ),
      400,
    );
    assertEquals(generic.error, "Auth backend exploded");
  },
);

const LIVE_GRANT_ROW = {
  id: "grant-1",
  person_id: "person-grant",
  created_by_auth_user_id: "user-grant",
  allowed_sources: ["tbank_web"],
  revoked_at: null,
  expires_at: null,
};

function grantSessionRequest(): Request {
  return new Request("http://localhost/functions/v1/money-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer grant-token",
    },
    body: JSON.stringify({
      action: "create_session",
      source: "tbank_web",
      payer_person_id: "person-somebody-else",
    }),
  });
}

Deno.test("money-import handler starts a session from a grant", async () => {
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock({ grantByToken: LIVE_GRANT_ROW }),
  });

  const payload = await assertJsonResponse<{ payer_person_id: string }>(
    await handler(grantSessionRequest()),
    200,
  );
  // The grant names the payer, not the request body.
  assertEquals(payload.payer_person_id, "person-grant");
});

Deno.test("money-import handler refuses a grant whose issuer lost access", async () => {
  // The end-to-end shape of the same rule auth_test covers directly: taking the issuer out of
  // allowed_users has to stop the extension importing, and the only thing that changes here is
  // the allowlist answer -- the grant row is untouched, neither revoked nor expired.
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock({
      grantByToken: LIVE_GRANT_ROW,
      issuerIsAllowed: false,
    }),
  });

  const payload = await assertJsonResponse<{ error: string }>(
    await handler(grantSessionRequest()),
    401,
  );
  assertEquals(payload.error, "Unauthorized");
});

Deno.test("money-import handler does not accept a grant for a later action", async () => {
  const handler = createMoneyImportHandler({
    repository: createRepositoryMock({ grantByToken: LIVE_GRANT_ROW }),
  });

  const payload = await assertJsonResponse<{ error: string }>(
    await handler(
      new Request("http://localhost/functions/v1/money-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer grant-token",
        },
        body: JSON.stringify({ action: "preview_rows", session_id: "session-1", rows: [] }),
      }),
    ),
    401,
  );
  assertEquals(payload.error, "Unauthorized");
});

function sessionTokenRequest(action: string, body: Record<string, unknown>): Request {
  return new Request("http://localhost/functions/v1/money-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer session-token",
    },
    body: JSON.stringify({ action, ...body }),
  });
}

const GRANT_MINTED_SESSION_ROW = {
  id: "session-1",
  batch_id: "batch-1",
  source: "tbank_web",
  payer_person_id: "person-1",
  status: "running",
  revoked_at: null,
  expires_at: "2999-01-01T00:00:00.000Z",
  grant_id: "grant-1",
};

Deno.test(
  "money-import handler stops a grant-minted session once its grant is revoked",
  async () => {
    // The session is untouched: not revoked, not expired, running. Only the grant that minted it
    // has been revoked -- and on every action that takes a session token, that is enough. The
    // session's own TTL is hours now; "revoked" cannot mean "keeps writing until then".
    const revoked = createMoneyImportHandler({
      repository: createRepositoryMock({
        sessionByToken: GRANT_MINTED_SESSION_ROW,
        grantByToken: { ...LIVE_GRANT_ROW, revoked_at: "2026-08-01T00:00:00.000Z" },
      }),
    });
    for (const action of ["preview_rows", "apply_rows", "complete_session"]) {
      const payload = await assertJsonResponse<{ error: string }>(
        await revoked(sessionTokenRequest(action, { session_id: "session-1", rows: [] })),
        401,
      );
      assertEquals(payload.error, "Unauthorized", action);
    }

    // The same session under a live grant goes through: the re-check is a check, not a refusal.
    const live = createMoneyImportHandler({
      repository: createRepositoryMock({
        sessionByToken: GRANT_MINTED_SESSION_ROW,
        grantByToken: LIVE_GRANT_ROW,
      }),
    });
    const response = await live(
      sessionTokenRequest("complete_session", { session_id: "session-1", status: "completed" }),
    );
    const body = await response.json();
    assertEquals(response.status !== 401, true, JSON.stringify(body));
  },
);

Deno.test("money-import handler lets a session token run the receipt preflight", async () => {
  // Before this, the action took user tokens only. A grant-backed run has none, so its preflight
  // came back 401, read as "nothing exists", and every receipt was fetched again.
  let askedFor: { source: string; payerPersonId: string } | undefined;
  const handler = createMoneyImportHandler({
    repository: {
      ...createRepositoryMock(),
      getExistingTransactionStates: async (source: string, payerPersonId: string) => {
        askedFor = { source, payerPersonId };
        return [];
      },
    },
  });

  const payload = await assertJsonResponse<{ states: unknown[] }>(
    await handler(
      sessionTokenRequest("get_existing_transaction_states", {
        source: "alfa_web",
        payer_person_id: "person-somebody-else",
        candidates: [{ external_id: "ext-1" }],
      }),
    ),
    200,
  );
  assertEquals(payload.states, []);
  // The session's own import, whatever the body named.
  assertEquals(askedFor, { source: "tbank_web", payerPersonId: "person-1" });
});
