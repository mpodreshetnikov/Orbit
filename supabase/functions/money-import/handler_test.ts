// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "../_shared/cors.ts";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { createMoneyImportHandler } from "./handler.ts";
import type { MoneyImportRepository } from "./repository.ts";

function createRepositoryMock(
  options: {
    sessionForUser?: Record<string, unknown> | null;
    sessionByToken?: Record<string, unknown> | null;
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
    getImportSessionForUser: async () => options.sessionForUser ?? null,
    getImportSessionById: async () => options.sessionForUser ?? null,
    updateImportSession: async () => {},
    createImportBatch: async () => "batch-1",
    getImportBatch: async () => ({
      id: "batch-1",
      parsed_transactions_count: 0,
      inserted_count: 0,
      skipped_count: 0,
      error_count: 0,
      parsed_through_at: null,
      status: "running",
    }),
    updateImportBatch: async () => {},
    resolveAccountIdForRow: async () => "acc-1",
    insertOrResolveTransaction: async () => ({ transactionId: "tx-1", inserted: true }),
    insertLineItemIfNew: async () => ({ lineItemId: "line-1", inserted: true }),
    insertReportRow: async () => "report-1",
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

Deno.test("money-import handler runs create_session and apply_rows happy paths", async () => {
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

  const applyRowsPayload = await assertJsonResponse<{
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
          action: "apply_rows",
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
  assertEquals(applyRowsPayload.inserted, 1);
  assertEquals(applyRowsPayload.skipped, 0);
  assertEquals(applyRowsPayload.error_count, 0);
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
