// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { getExistingTransactionStatesAction } from "./existing-transaction-states.ts";
import type { ExistingTransactionStateResult, UserAuthContext } from "./types.ts";

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
      user_id: "user-1",
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
