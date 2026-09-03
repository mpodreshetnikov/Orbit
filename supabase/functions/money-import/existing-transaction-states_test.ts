// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { getExistingTransactionStatesAction } from "./existing-transaction-states.ts";
import type {
  ExistingTransactionStateResult,
  SessionAuthContext,
  UserAuthContext,
} from "./types.ts";

const auth: UserAuthContext = {
  mode: "user",
  token: "token",
  userId: "user-1",
  email: "user@example.com",
};

function createTelemetryMock() {
  return {
    startSpan: () => ({
      end: async () => {},
    }),
    info: () => {},
  };
}

Deno.test("getExistingTransactionStatesAction validates source and payer person", async () => {
  const payload = await assertJsonResponse<{ error: string }>(
    await getExistingTransactionStatesAction(
      {
        source: "",
        payer_person_id: null,
        candidates: [],
      },
      auth,
      {
        repository: {
          getExistingTransactionStates: async () => [],
        } as never,
        telemetry: createTelemetryMock() as never,
      },
    ),
    400,
  );

  assertEquals(payload.error, "source and payer_person_id are required");
});

Deno.test(
  "getExistingTransactionStatesAction validates source and payer person without telemetry",
  async () => {
    const payload = await assertJsonResponse<{ error: string }>(
      await getExistingTransactionStatesAction(
        {
          source: "",
          payer_person_id: null,
          candidates: [],
        },
        auth,
        {
          repository: {
            getExistingTransactionStates: async () => [],
          } as never,
        },
      ),
      400,
    );

    assertEquals(payload.error, "source and payer_person_id are required");
  },
);

Deno.test("getExistingTransactionStatesAction requires candidates to be an array", async () => {
  const payload = await assertJsonResponse<{ error: string }>(
    await getExistingTransactionStatesAction(
      {
        source: "tbank",
        payer_person_id: "person-1",
        candidates: "bad",
      },
      auth,
      {
        repository: {
          getExistingTransactionStates: async () => [],
        } as never,
        telemetry: createTelemetryMock() as never,
      },
    ),
    400,
  );

  assertEquals(payload.error, "candidates must be an array");
});

Deno.test("getExistingTransactionStatesAction returns repository states", async () => {
  let repositoryCall:
    | {
        source: string;
        payerPersonId: string;
        candidates: unknown[];
      }
    | undefined;
  let telemetryPayload:
    | {
        event: string;
        attrs: Record<string, unknown>;
      }
    | undefined;

  const states: ExistingTransactionStateResult[] = [
    {
      transaction_id: "tx-1",
      exists: true,
      fulfilled: true,
      has_only_synthetic_line_items: false,
      has_real_line_items: true,
      receipt_enrichment_status: "ok",
    },
    {
      transaction_id: null,
      exists: false,
      fulfilled: false,
      has_only_synthetic_line_items: false,
      has_real_line_items: false,
      receipt_enrichment_status: null,
    },
  ];

  const payload = await assertJsonResponse<{ states: ExistingTransactionStateResult[] }>(
    await getExistingTransactionStatesAction(
      {
        source: "tbank",
        payer_person_id: "person-1",
        candidates: [{ external_id: "ext-1" }, { external_id: "ext-2" }],
      },
      auth,
      {
        repository: {
          getExistingTransactionStates: async (
            source: string,
            payerPersonId: string,
            candidates: unknown[],
          ) => {
            repositoryCall = { source, payerPersonId, candidates };
            return states;
          },
        } as never,
        telemetry: {
          startSpan: () => ({
            end: async () => {},
          }),
          info: (event: string, attrs: Record<string, unknown>) => {
            telemetryPayload = { event, attrs };
          },
        } as never,
      },
    ),
    200,
  );

  assertEquals(payload.states, states);
  assertEquals(repositoryCall, {
    source: "tbank",
    payerPersonId: "person-1",
    candidates: [{ external_id: "ext-1" }, { external_id: "ext-2" }],
  });
  assertEquals(telemetryPayload, {
    event: "money_import_get_existing_transaction_states_completed",
    attrs: {
      source: "tbank",
      auth_mode: "user",
      user_id: "user-1",
      session_id: null,
      candidate_count: 2,
      fulfilled_count: 1,
    },
  });
});

Deno.test("getExistingTransactionStatesAction works without telemetry", async () => {
  const states: ExistingTransactionStateResult[] = [
    {
      transaction_id: null,
      exists: false,
      fulfilled: false,
      has_only_synthetic_line_items: false,
      has_real_line_items: false,
      receipt_enrichment_status: null,
    },
  ];

  const payload = await assertJsonResponse<{ states: ExistingTransactionStateResult[] }>(
    await getExistingTransactionStatesAction(
      {
        source: "tbank",
        payer_person_id: "person-1",
        candidates: [{ external_id: "ext-1" }],
      },
      auth,
      {
        repository: {
          getExistingTransactionStates: async () => states,
        } as never,
      },
    ),
    200,
  );

  assertEquals(payload.states, states);
});

Deno.test(
  "getExistingTransactionStatesAction answers a session about its own import only",
  async () => {
    // A run nobody started asks on its session token. The body may name any source and payer; the
    // session's own are what the repository is asked about.
    const sessionAuth: SessionAuthContext = {
      mode: "session",
      token: "session-token",
      session: {
        id: "session-1",
        source: "tbank_web",
        payer_person_id: "person-session",
        status: "running",
        revoked_at: null,
        expires_at: "2999-01-01T00:00:00.000Z",
      },
    };
    let repositoryCall: { source: string; payerPersonId: string } | undefined;

    const payload = await assertJsonResponse<{ states: unknown[] }>(
      await getExistingTransactionStatesAction(
        {
          source: "alfa_web",
          payer_person_id: "person-somebody-else",
          candidates: [{ external_id: "ext-1" }],
        },
        sessionAuth,
        {
          repository: {
            getExistingTransactionStates: async (source: string, payerPersonId: string) => {
              repositoryCall = { source, payerPersonId };
              return [];
            },
          } as never,
          telemetry: createTelemetryMock() as never,
        },
      ),
      200,
    );

    assertEquals(payload.states, []);
    assertEquals(repositoryCall, { source: "tbank_web", payerPersonId: "person-session" });

    // A session past its time answers nothing, the way every other session action refuses it.
    const expired = await assertJsonResponse<{ error: string }>(
      await getExistingTransactionStatesAction(
        { candidates: [] },
        {
          ...sessionAuth,
          session: { ...sessionAuth.session, expires_at: "2000-01-01T00:00:00.000Z" },
        },
        {
          repository: { getExistingTransactionStates: async () => [] } as never,
          telemetry: createTelemetryMock() as never,
        },
      ),
      401,
    );
    assertEquals(expired.error, "Import session expired or revoked");
  },
);
