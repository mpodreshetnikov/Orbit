import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { corsHeaders } from "../_shared/cors.ts";
import type { Database } from "../_shared/database.types.ts";
import { createEdgeLogEvent, logEdgeEvent } from "../_shared/observability.ts";
import {
  filterUnsentRowsByAllowedPersons,
  mapDigestRowsToNotifications,
  type NotificationDigestRow,
  type NotificationItem,
  type RoutedPersonRow,
} from "./digest.ts";
import { buildPushPayload } from "./push.ts";
import { isNotificationWindowForUser } from "./window.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const VAPID_PUBLIC_KEY =
  Deno.env.get("VAPID_PUBLIC_KEY") ?? Deno.env.get("SUBSCRIPTION_VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY =
  Deno.env.get("VAPID_PRIVATE_KEY") ?? Deno.env.get("SUBSCRIPTION_VAPID_PRIVATE_KEY");

const NOTIFICATION_PROVIDERS_IN_WINDOW: { type: string; rpc: string }[] = [
  { type: "checkup", rpc: "get_checkup_notification_payload_for_person" },
];
const NOTIFICATION_PROVIDERS_EVERY_TICK: { type: string; rpc: string }[] = [];

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface UserPrefsRow {
  auth_user_id: string;
  checkup_notification_time: string;
  checkup_notification_timezone: string | null;
}

interface PayloadRow {
  person_id?: string | null;
  scheduled_at: string;
  window_start?: string | null;
  window_end?: string | null;
  title: string;
  body: string;
  url: string;
}

interface WebPushClientLike {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

interface NotificationProvider {
  type: string;
  rpc: string;
}

export interface NotificationsCronDeps {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  vapidPublicKey?: string | null;
  vapidPrivateKey?: string | null;
  createClientFn?: typeof createClient;
  webpushClient?: WebPushClientLike;
  providersInWindow?: NotificationProvider[];
  providersEveryTick?: NotificationProvider[];
  now?: () => Date;
  log?: Pick<Console, "log" | "error">;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function createNotificationsCronHandler(deps: NotificationsCronDeps = {}) {
  const createClientFn = deps.createClientFn ?? createClient;
  const webpushClient = deps.webpushClient ?? (webpush as unknown as WebPushClientLike);
  const log = deps.log ?? console;
  const providersInWindow = deps.providersInWindow ?? NOTIFICATION_PROVIDERS_IN_WINDOW;
  const providersEveryTick = deps.providersEveryTick ?? NOTIFICATION_PROVIDERS_EVERY_TICK;

  const resolvedSupabaseUrl = deps.supabaseUrl ?? SUPABASE_URL;
  const resolvedServiceRoleKey = deps.supabaseServiceRoleKey ?? SUPABASE_SERVICE_ROLE_KEY;
  const resolvedVapidPublic = deps.vapidPublicKey ?? VAPID_PUBLIC_KEY;
  const resolvedVapidPrivate = deps.vapidPrivateKey ?? VAPID_PRIVATE_KEY;
  const emit = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    attrs?: Record<string, boolean | number | string | null>,
  ) => {
    logEdgeEvent(
      createEdgeLogEvent(level, message, {
        component: "notifications-cron",
        attrs,
      }),
    );
  };

  return async function handleNotificationsCronRequest(req: Request): Promise<Response> {
    emit("info", "notifications_cron_invocation_started", {
      request_method: req.method,
    });

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (!resolvedSupabaseUrl || !resolvedServiceRoleKey) {
      log.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      emit("error", "notifications_cron_missing_supabase_config");
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const supabase = createClientFn<Database>(resolvedSupabaseUrl, resolvedServiceRoleKey);
    const now = deps.now ? deps.now() : new Date();

    const { data: subs } = await supabase.from("push_subscriptions").select("auth_user_id");
    const userIds = [
      ...new Set((subs ?? []).map((row: { auth_user_id: string }) => row.auth_user_id)),
    ];
    if (userIds.length === 0) {
      emit("info", "notifications_cron_no_subscriptions");
      return jsonResponse({ ok: true, processed: 0 }, 200);
    }

    await supabase.rpc("create_medication_reminder_digests", {
      p_now_timestamptz: now.toISOString(),
    });

    const { data: prefsRows } = await supabase
      .from("user_preferences")
      .select("auth_user_id, checkup_notification_time, checkup_notification_timezone")
      .in("auth_user_id", userIds);

    const prefsByUser = new Map<string, UserPrefsRow>();
    for (const item of prefsRows ?? []) {
      prefsByUser.set(item.auth_user_id, item as UserPrefsRow);
    }

    const defaultPrefs: UserPrefsRow = {
      auth_user_id: "",
      checkup_notification_time: "09:00",
      checkup_notification_timezone: null,
    };

    let processed = 0;
    for (const authUserId of userIds) {
      const prefs = prefsByUser.get(authUserId) ?? { ...defaultPrefs, auth_user_id: authUserId };
      const timeStr = prefs.checkup_notification_time ?? "09:00";
      const tz = prefs.checkup_notification_timezone ?? undefined;
      const inWindow = isNotificationWindowForUser(now, timeStr, tz ?? null);

      const { data: routedPersons } = await supabase.rpc("get_routed_persons_for_recipient", {
        p_recipient_user_id: authUserId,
      });
      const routedPersonRows = (routedPersons ?? []) as RoutedPersonRow[];

      const { data: unsentRows } = await supabase
        .from("notification_digests")
        .select("id, type, scheduled_at, payload_json, person_id")
        .eq("auth_user_id", authUserId)
        .is("sent_at", null)
        .order("scheduled_at", { ascending: true })
        .limit(1000);

      const filteredRows = filterUnsentRowsByAllowedPersons(
        (unsentRows ?? []) as NotificationDigestRow[],
        routedPersonRows,
      );
      const notificationsForUser: NotificationItem[] = mapDigestRowsToNotifications(
        filteredRows,
        routedPersonRows,
        authUserId,
        inWindow,
      );
      const seenIds = new Set(notificationsForUser.map((item) => item.id));

      const processPayloadRows = async (
        provider: { type: string; rpc: string },
        payloadRows: PayloadRow[] | null,
        personMeta: RoutedPersonRow | null,
      ) => {
        if (!payloadRows || payloadRows.length === 0) return;

        for (const payloadRow of payloadRows) {
          const windowStart = payloadRow.window_start ?? null;
          const windowEnd = payloadRow.window_end ?? null;
          const personId = payloadRow.person_id ?? personMeta?.person_id ?? null;
          const isOwnPerson = personId != null && personMeta?.person_owner_user_id === authUserId;
          const personName = personMeta?.person_name ?? null;
          const titlePrefix = isOwnPerson
            ? null
            : (personMeta?.custom_prefix ?? personName ?? null);

          let digestId: string;
          let scheduledAt: string;
          let payloadJson: {
            title: string;
            body: string;
            url: string;
            person_id?: string | null;
            person_name?: string | null;
            title_prefix?: string | null;
          };

          if (windowStart != null && windowEnd != null) {
            let existingQuery = supabase
              .from("notification_digests")
              .select("id, scheduled_at, payload_json, sent_at")
              .eq("auth_user_id", authUserId)
              .eq("type", provider.type)
              .lt("window_start", windowEnd)
              .gt("window_end", windowStart);

            if (personId) {
              existingQuery = existingQuery.eq("person_id", personId);
            }

            const { data: existing } = await existingQuery.maybeSingle();
            if (existing) {
              if (existing.sent_at != null) continue;
              digestId = existing.id;
              scheduledAt = existing.scheduled_at as string;
              payloadJson = existing.payload_json as {
                title: string;
                body: string;
                url: string;
                person_id?: string | null;
                person_name?: string | null;
                title_prefix?: string | null;
              };
            } else {
              const { data: inserted, error: insertError } = await supabase
                .from("notification_digests")
                .insert({
                  auth_user_id: authUserId,
                  person_id: personId,
                  type: provider.type,
                  scheduled_at: payloadRow.scheduled_at,
                  window_start: windowStart,
                  window_end: windowEnd,
                  payload_json: {
                    title: payloadRow.title,
                    body: payloadRow.body,
                    url: payloadRow.url,
                    person_id: personId,
                    person_name: personName,
                    title_prefix: titlePrefix,
                  },
                })
                .select("id")
                .single();

              if (insertError || !inserted) {
                log.error(`Insert notification_digest failed (${provider.type}):`, insertError);
                continue;
              }

              digestId = inserted.id;
              scheduledAt = payloadRow.scheduled_at;
              payloadJson = {
                title: payloadRow.title,
                body: payloadRow.body,
                url: payloadRow.url,
                person_id: personId,
                person_name: personName,
                title_prefix: titlePrefix,
              };
            }
          } else {
            const { data: inserted, error: insertError } = await supabase
              .from("notification_digests")
              .insert({
                auth_user_id: authUserId,
                person_id: personId,
                type: provider.type,
                scheduled_at: payloadRow.scheduled_at,
                payload_json: {
                  title: payloadRow.title,
                  body: payloadRow.body,
                  url: payloadRow.url,
                  person_id: personId,
                  person_name: personName,
                  title_prefix: titlePrefix,
                },
              })
              .select("id")
              .single();

            if (insertError || !inserted) {
              log.error(`Insert notification_digest failed (${provider.type}):`, insertError);
              continue;
            }

            digestId = inserted.id;
            scheduledAt = payloadRow.scheduled_at;
            payloadJson = {
              title: payloadRow.title,
              body: payloadRow.body,
              url: payloadRow.url,
              person_id: personId,
              person_name: personName,
              title_prefix: titlePrefix,
            };
          }

          if (!seenIds.has(digestId)) {
            seenIds.add(digestId);
            notificationsForUser.push({
              id: digestId,
              type: provider.type,
              title: payloadJson.title,
              body: payloadJson.body,
              url: payloadJson.url,
              scheduledAt,
              personId: payloadJson.person_id ?? null,
              personName: payloadJson.person_name ?? null,
              titlePrefix: payloadJson.title_prefix ?? null,
            });
          }
        }
      };

      for (const provider of providersEveryTick) {
        const { data: payloadRows } = await supabase.rpc(
          provider.rpc as keyof Database["public"]["Functions"],
          {
            p_auth_user_id: authUserId,
            p_now_timestamptz: now.toISOString(),
            p_timezone: tz ?? null,
          },
        );
        await processPayloadRows(provider, payloadRows as PayloadRow[] | null, null);
      }

      if (inWindow) {
        const dateStr = tz
          ? new Date(now.toLocaleString("en-US", { timeZone: tz })).toISOString().slice(0, 10)
          : now.toISOString().slice(0, 10);
        for (const provider of providersInWindow) {
          for (const person of routedPersonRows) {
            const { data: payloadRows } = await supabase.rpc(
              provider.rpc as keyof Database["public"]["Functions"],
              {
                p_person_id: person.person_id,
                p_date: dateStr,
                p_notification_time: timeStr,
                p_timezone: tz ?? null,
              },
            );
            await processPayloadRows(provider, payloadRows as PayloadRow[] | null, person);
          }
        }
      }

      if (notificationsForUser.length === 0) continue;

      const { data: userSubs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("auth_user_id", authUserId);

      if (resolvedVapidPublic && resolvedVapidPrivate && userSubs?.length) {
        try {
          webpushClient.setVapidDetails(
            "mailto:support@example.com",
            resolvedVapidPublic,
            resolvedVapidPrivate,
          );
          const payloadToSend = buildPushPayload(notificationsForUser);

          for (const sub of userSubs as PushSubscriptionRow[]) {
            try {
              await webpushClient.sendNotification(
                {
                  endpoint: sub.endpoint,
                  keys: { p256dh: sub.p256dh, auth: sub.auth },
                },
                JSON.stringify({ notifications: payloadToSend }),
                { TTL: 86400 },
              );
            } catch (error) {
              if (
                error &&
                typeof error === "object" &&
                "statusCode" in error &&
                ((error as { statusCode?: number }).statusCode === 410 ||
                  (error as { statusCode?: number }).statusCode === 404)
              ) {
                await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
              }
            }
          }

          const sentDigestIds = [...new Set(notificationsForUser.map((item) => item.id))];
          if (sentDigestIds.length > 0) {
            await supabase
              .from("notification_digests")
              .update({ sent_at: now.toISOString() })
              .in("id", sentDigestIds);
          }

          const doseEventIdsToMarkSent = notificationsForUser
            .filter(
              (item) => item.type === "medication" && item.dose_event_id && !item.isOverdueReminder,
            )
            .map((item) => item.dose_event_id as string);
          if (doseEventIdsToMarkSent.length > 0) {
            await supabase
              .from("med_dose_events")
              .update({ status: "sent", updated_at: new Date().toISOString() })
              .in("id", doseEventIdsToMarkSent);
          }
        } catch (error) {
          log.error("Web Push send failed:", error);
        }
      }

      processed += 1;
    }

    return jsonResponse({ ok: true, processed }, 200);
  };
}

export const handleRequest = createNotificationsCronHandler();
