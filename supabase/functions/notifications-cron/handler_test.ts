// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { createNotificationsCronHandler } from "./handler.ts";

interface NotificationState {
  deletedEndpoints: string[];
  updatedDigestIds: string[];
  updatedDoseEventIds: string[];
  insertedDigests: Record<string, unknown>[];
  sentPayloads: string[];
}

function createState(): NotificationState {
  return {
    deletedEndpoints: [],
    updatedDigestIds: [],
    updatedDoseEventIds: [],
    insertedDigests: [],
    sentPayloads: [],
  };
}

function createZeroSubscriberClient() {
  return {
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      if (table === "push_subscriptions") {
        return {
          select: async () => ({ data: [], error: null }),
        };
      }
      return { select: async () => ({ data: [], error: null }) };
    },
  };
}

function createNoNotificationsClient() {
  return {
    rpc: async (name: string) => {
      if (name === "create_medication_reminder_digests") return { data: null, error: null };
      if (name === "get_routed_persons_for_recipient") return { data: [], error: null };
      if (name === "get_checkup_notification_payload_for_person") return { data: [], error: null };
      return { data: [], error: null };
    },
    from: (table: string) => {
      if (table === "push_subscriptions") {
        return {
          select: (columns: string) => {
            if (columns === "auth_user_id") {
              return Promise.resolve({ data: [{ auth_user_id: "user-1" }], error: null });
            }
            return {
              eq: async () => ({ data: [], error: null }),
            };
          },
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }

      if (table === "user_preferences") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  auth_user_id: "user-1",
                  checkup_notification_time: "09:00",
                  checkup_notification_timezone: null,
                },
              ],
              error: null,
            }),
          }),
        };
      }

      if (table === "notification_digests") {
        const unsentChain = {
          eq: () => unsentChain,
          is: () => unsentChain,
          order: () => unsentChain,
          limit: async () => ({ data: [], error: null }),
        };
        return {
          select: () => unsentChain,
          update: () => ({
            in: async () => ({ error: null }),
          }),
        };
      }

      return {
        select: async () => ({ data: [], error: null }),
      };
    },
  };
}

function createComplexClient(state: NotificationState) {
  return {
    rpc: async (name: string, params: Record<string, unknown>) => {
      if (name === "create_medication_reminder_digests") return { data: null, error: null };
      if (name === "get_routed_persons_for_recipient") {
        return {
          data: [
            {
              person_id: "p1",
              person_name: "Alice",
              custom_prefix: "For Alice",
              person_owner_user_id: "user-2",
            },
          ],
          error: null,
        };
      }
      if (name === "get_checkup_notification_payload_for_person") {
        return {
          data: [
            {
              person_id: "p1",
              scheduled_at: "2026-01-01T09:00:00.000Z",
              window_start: "2026-01-01T08:45:00.000Z",
              window_end: "2026-01-01T09:15:00.000Z",
              title: "Checkup",
              body: "Do checkup",
              url: "/health/checkups",
            },
            {
              person_id: "p1",
              scheduled_at: "2026-01-01T09:30:00.000Z",
              window_start: null,
              window_end: null,
              title: "General",
              body: "General reminder",
              url: "/health/checkups",
            },
          ],
          error: null,
        };
      }
      if (name === "get_checkup_notification_payload_for_person" && params.p_person_id === "p2") {
        return { data: [], error: null };
      }
      return { data: [], error: null };
    },
    from: (table: string) => {
      if (table === "push_subscriptions") {
        return {
          select: (columns: string) => {
            if (columns === "auth_user_id") {
              return Promise.resolve({ data: [{ auth_user_id: "user-1" }], error: null });
            }
            return {
              eq: async () => ({
                data: [
                  { endpoint: "https://push.example/stale", p256dh: "k1", auth: "a1" },
                  { endpoint: "https://push.example/live", p256dh: "k2", auth: "a2" },
                ],
                error: null,
              }),
            };
          },
          delete: () => ({
            eq: async (_column: string, endpoint: string) => {
              state.deletedEndpoints.push(endpoint);
              return { error: null };
            },
          }),
        };
      }

      if (table === "user_preferences") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  auth_user_id: "user-1",
                  checkup_notification_time: "09:00",
                  checkup_notification_timezone: null,
                },
              ],
              error: null,
            }),
          }),
        };
      }

      if (table === "notification_digests") {
        const unsentChain = {
          eq: () => unsentChain,
          is: () => unsentChain,
          order: () => unsentChain,
          limit: async () => ({
            data: [
              {
                id: "digest-med",
                type: "medication",
                scheduled_at: "2026-01-01T09:00:00.000Z",
                person_id: "p1",
                payload_json: {
                  title: "Medication",
                  body: "",
                  url: "/health/medications",
                  doses: [
                    {
                      dose_event_id: "dose-1",
                      medication_name: "Vitamin D",
                      amount: "1",
                      unit: "pill",
                      time_str: "09:00",
                    },
                  ],
                },
              },
            ],
            error: null,
          }),
        };

        const overlapChain = {
          eq: () => overlapChain,
          lt: () => overlapChain,
          gt: () => overlapChain,
          maybeSingle: async () => ({ data: null, error: null }),
        };

        return {
          select: (columns: string) => {
            if (columns.includes("sent_at")) return overlapChain;
            return unsentChain;
          },
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                state.insertedDigests.push(payload);
                return { data: { id: `inserted-${state.insertedDigests.length}` }, error: null };
              },
            }),
          }),
          update: () => ({
            in: async (_column: string, ids: string[]) => {
              state.updatedDigestIds = ids;
              return { error: null };
            },
          }),
        };
      }

      if (table === "med_dose_events") {
        return {
          update: () => ({
            in: async (_column: string, ids: string[]) => {
              state.updatedDoseEventIds = ids;
              return { error: null };
            },
          }),
        };
      }

      return {
        select: async () => ({ data: [], error: null }),
      };
    },
  };
}

Deno.test("notifications-cron handler responds to OPTIONS", async () => {
  const handler = createNotificationsCronHandler({
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-key",
    createClientFn: (() => createZeroSubscriberClient()) as unknown as typeof createClient,
    webpushClient: {
      setVapidDetails: () => {},
      sendNotification: async () => ({}),
    },
  });

  const response = await handler(
    new Request("http://localhost/functions/v1/notifications-cron", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    corsHeaders["Access-Control-Allow-Origin"],
  );
});

Deno.test("notifications-cron handler fails when Supabase env is missing", async () => {
  const handler = createNotificationsCronHandler({
    supabaseUrl: undefined,
    supabaseServiceRoleKey: undefined,
  });

  const payload = await assertJsonResponse<{ error: string }>(
    await handler(
      new Request("http://localhost/functions/v1/notifications-cron", { method: "POST" }),
    ),
    500,
  );
  assertEquals(payload.error, "Server configuration error");
});

Deno.test("notifications-cron handler exits early when no subscribers exist", async () => {
  const handler = createNotificationsCronHandler({
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-key",
    createClientFn: (() => createZeroSubscriberClient()) as unknown as typeof createClient,
    webpushClient: {
      setVapidDetails: () => {},
      sendNotification: async () => ({}),
    },
  });

  const payload = await assertJsonResponse<{ ok: boolean; processed: number }>(
    await handler(
      new Request("http://localhost/functions/v1/notifications-cron", { method: "POST" }),
    ),
    200,
  );
  assertEquals(payload.ok, true);
  assertEquals(payload.processed, 0);
});

Deno.test(
  "notifications-cron handler skips push send when no notifications are generated",
  async () => {
    const state = createState();
    const handler = createNotificationsCronHandler({
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role-key",
      vapidPublicKey: "public",
      vapidPrivateKey: "private",
      createClientFn: (() => createNoNotificationsClient()) as unknown as typeof createClient,
      webpushClient: {
        setVapidDetails: () => {},
        sendNotification: async (_subscription, payload) => {
          state.sentPayloads.push(payload);
          return {};
        },
      },
      now: () => new Date("2026-01-01T01:00:00.000Z"),
    });

    const payload = await assertJsonResponse<{ ok: boolean; processed: number }>(
      await handler(
        new Request("http://localhost/functions/v1/notifications-cron", { method: "POST" }),
      ),
      200,
    );
    assertEquals(payload.processed, 0);
    assertEquals(state.sentPayloads.length, 0);
  },
);

Deno.test(
  "notifications-cron handler inserts provider digests, cleans stale subs and marks sent",
  async () => {
    const state = createState();
    let sendCalls = 0;

    const handler = createNotificationsCronHandler({
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role-key",
      vapidPublicKey: "public",
      vapidPrivateKey: "private",
      createClientFn: (() => createComplexClient(state)) as unknown as typeof createClient,
      webpushClient: {
        setVapidDetails: () => {},
        sendNotification: async (_subscription, payload) => {
          sendCalls += 1;
          state.sentPayloads.push(payload);
          if (sendCalls === 1) {
            throw { statusCode: 410 };
          }
          return {};
        },
      },
      now: () => new Date(2026, 0, 1, 9, 0, 0),
    });

    const payload = await assertJsonResponse<{ ok: boolean; processed: number }>(
      await handler(
        new Request("http://localhost/functions/v1/notifications-cron", { method: "POST" }),
      ),
      200,
    );

    assertEquals(payload.ok, true);
    assertEquals(payload.processed, 1);
    assertEquals(state.insertedDigests.length, 2);
    assertEquals(state.deletedEndpoints, ["https://push.example/stale"]);
    assertEquals(state.updatedDigestIds.length > 0, true);
    assertEquals(state.updatedDoseEventIds, ["dose-1"]);
    assertEquals(state.sentPayloads.length, 2);
  },
);

Deno.test("notifications-cron handler keeps running when webpush setup throws", async () => {
  const state = createState();
  const handler = createNotificationsCronHandler({
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-key",
    vapidPublicKey: "public",
    vapidPrivateKey: "private",
    createClientFn: (() => createComplexClient(state)) as unknown as typeof createClient,
    webpushClient: {
      setVapidDetails: () => {
        throw new Error("vapid setup failed");
      },
      sendNotification: async () => ({}),
    },
    now: () => new Date(2026, 0, 1, 9, 0, 0),
  });

  const payload = await assertJsonResponse<{ ok: boolean; processed: number }>(
    await handler(
      new Request("http://localhost/functions/v1/notifications-cron", { method: "POST" }),
    ),
    200,
  );
  assertEquals(payload.ok, true);
  assertEquals(payload.processed, 1);
});

function createBranchCoverageClient(
  state: NotificationState,
  capture: { inWindowRpcCalls: unknown[] },
) {
  let existingLookupCall = 0;
  let insertCall = 0;

  return {
    rpc: async (name: string, params: Record<string, unknown>) => {
      if (name === "create_medication_reminder_digests") return { data: null, error: null };
      if (name === "get_routed_persons_for_recipient") {
        return {
          data: [
            {
              person_id: "p1",
              person_name: "Alice",
              custom_prefix: "For Alice",
              person_owner_user_id: "user-1",
            },
          ],
          error: null,
        };
      }
      if (name === "provider_every_tick") {
        return {
          data: [
            {
              person_id: null,
              scheduled_at: "2026-01-01T09:00:00.000Z",
              title: "Tick Error",
              body: "Should fail insert",
              url: "/tick-error",
            },
            {
              person_id: null,
              scheduled_at: "2026-01-01T09:10:00.000Z",
              title: "Tick Success",
              body: "Inserted",
              url: "/tick-success",
            },
          ],
          error: null,
        };
      }
      if (name === "provider_in_window") {
        capture.inWindowRpcCalls.push(params);
        return {
          data: [
            {
              person_id: "p1",
              scheduled_at: "2026-01-01T09:00:00.000Z",
              window_start: "2026-01-01T08:45:00.000Z",
              window_end: "2026-01-01T09:15:00.000Z",
              title: "Window Existing Sent",
              body: "Skip",
              url: "/window-existing",
            },
            {
              person_id: "p1",
              scheduled_at: "2026-01-01T09:30:00.000Z",
              window_start: "2026-01-01T09:15:00.000Z",
              window_end: "2026-01-01T09:45:00.000Z",
              title: "Window Insert Error",
              body: "Should fail",
              url: "/window-error",
            },
            {
              person_id: "p1",
              scheduled_at: "2026-01-01T09:40:00.000Z",
              window_start: "2026-01-01T09:35:00.000Z",
              window_end: "2026-01-01T10:05:00.000Z",
              title: "Window Insert Success",
              body: "Inserted",
              url: "/window-success",
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    },
    from: (table: string) => {
      if (table === "push_subscriptions") {
        return {
          select: (columns: string) => {
            if (columns === "auth_user_id") {
              // duplicate IDs should collapse to one unique user
              return Promise.resolve({
                data: [{ auth_user_id: "user-1" }, { auth_user_id: "user-1" }],
                error: null,
              });
            }
            return {
              eq: async () => ({
                data: [{ endpoint: "https://push.example/live", p256dh: "k1", auth: "a1" }],
                error: null,
              }),
            };
          },
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }

      if (table === "user_preferences") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  auth_user_id: "user-1",
                  checkup_notification_time: null,
                  checkup_notification_timezone: "UTC",
                },
              ],
              error: null,
            }),
          }),
        };
      }

      if (table === "notification_digests") {
        const unsentChain = {
          eq: () => unsentChain,
          is: () => unsentChain,
          order: () => unsentChain,
          limit: async () => ({ data: null, error: null }),
        };

        const overlapChain = {
          eq: () => overlapChain,
          lt: () => overlapChain,
          gt: () => overlapChain,
          maybeSingle: async () => {
            existingLookupCall += 1;
            if (existingLookupCall === 1) {
              return {
                data: {
                  id: "existing-sent",
                  scheduled_at: "2026-01-01T09:00:00.000Z",
                  sent_at: "2026-01-01T09:01:00.000Z",
                  payload_json: {
                    title: "Sent",
                    body: "Already sent",
                    url: "/sent",
                    person_name: null,
                    title_prefix: null,
                  },
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };

        return {
          select: (columns: string) => {
            if (columns.includes("sent_at")) return overlapChain;
            return unsentChain;
          },
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                insertCall += 1;
                state.insertedDigests.push(payload);
                if (insertCall === 1)
                  return { data: null, error: { message: "tick insert failed" } };
                if (insertCall === 2) return { data: { id: "tick-ok" }, error: null };
                if (insertCall === 3)
                  return { data: null, error: { message: "window insert failed" } };
                return { data: { id: "window-ok" }, error: null };
              },
            }),
          }),
          update: () => ({
            in: async (_column: string, ids: string[]) => {
              state.updatedDigestIds = ids;
              return { error: null };
            },
          }),
        };
      }

      if (table === "med_dose_events") {
        return {
          update: () => ({
            in: async (_column: string, ids: string[]) => {
              state.updatedDoseEventIds = ids;
              return { error: null };
            },
          }),
        };
      }

      return {
        select: async () => ({ data: [], error: null }),
      };
    },
  };
}

Deno.test(
  "notifications-cron handler executes every-tick and in-window provider branches",
  async () => {
    const state = createState();
    const capture = { inWindowRpcCalls: [] as unknown[] };

    const handler = createNotificationsCronHandler({
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role-key",
      vapidPublicKey: "public",
      vapidPrivateKey: "private",
      providersEveryTick: [{ type: "checkup_every_tick", rpc: "provider_every_tick" }],
      providersInWindow: [{ type: "checkup", rpc: "provider_in_window" }],
      createClientFn: (() =>
        createBranchCoverageClient(state, capture)) as unknown as typeof createClient,
      webpushClient: {
        setVapidDetails: () => {},
        sendNotification: async (_subscription, payload) => {
          state.sentPayloads.push(payload);
          return {};
        },
      },
      now: () => new Date("2026-01-01T09:00:00.000Z"),
    });

    const payload = await assertJsonResponse<{ ok: boolean; processed: number }>(
      await handler(
        new Request("http://localhost/functions/v1/notifications-cron", { method: "POST" }),
      ),
      200,
    );

    assertEquals(payload.ok, true);
    assertEquals(payload.processed, 1);
    assertEquals(state.insertedDigests.length >= 4, true);
    assertEquals(capture.inWindowRpcCalls.length, 1);
    assertEquals(state.sentPayloads.length, 1);
  },
);

Deno.test(
  "notifications-cron handler removes stale subscriptions on 404 web-push responses",
  async () => {
    const state = createState();
    let sendCalls = 0;

    const handler = createNotificationsCronHandler({
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role-key",
      vapidPublicKey: "public",
      vapidPrivateKey: "private",
      createClientFn: (() => createComplexClient(state)) as unknown as typeof createClient,
      webpushClient: {
        setVapidDetails: () => {},
        sendNotification: async () => {
          sendCalls += 1;
          if (sendCalls === 1) throw { statusCode: 404 };
          return {};
        },
      },
      now: () => new Date(2026, 0, 1, 9, 0, 0),
    });

    const payload = await assertJsonResponse<{ ok: boolean; processed: number }>(
      await handler(
        new Request("http://localhost/functions/v1/notifications-cron", { method: "POST" }),
      ),
      200,
    );
    assertEquals(payload.ok, true);
    assertEquals(payload.processed, 1);
    assertEquals(state.deletedEndpoints, ["https://push.example/stale"]);
  },
);
