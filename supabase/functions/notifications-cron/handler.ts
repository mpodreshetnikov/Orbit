import { createClient } from "@supabase/supabase-js";
// @ts-types="./web-push.d.ts"
import webpush from "web-push";
import { corsHeaders } from "../_shared/cors.ts";
import type { Database } from "../_shared/database.types.ts";
import { createEdgeRequestContext, createEdgeTelemetry } from "../_shared/observability.ts";
import {
  filterUnsentRowsByAllowedPersons,
  mapDigestRowsToNotifications,
  type NotificationDigestRow,
  type NotificationItem,
  type RoutedPersonRow,
} from "./digest.ts";
import {
  isAppleWebPushEndpoint,
  readApnsConfig,
  sendLiveActivityStart,
  type ApnsConfig,
  type ApnsEnvironment,
  type LiveActivityStartPayload,
} from "./apns.ts";
import { aggregateMedicationNotifications, buildPushPayload } from "./push.ts";
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
  suppress_medication_push?: boolean | null;
}

interface LiveActivityTokenRow {
  push_to_start_token: string;
  bundle_id: string;
  apns_environment: ApnsEnvironment;
}

export type ApnsSender = typeof sendLiveActivityStart;

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
  log?: Pick<Console, "log" | "error" | "info" | "debug" | "warn">;
  apnsConfig?: ApnsConfig | null;
  sendLiveActivityStartFn?: ApnsSender;
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
  const sendLiveActivity = deps.sendLiveActivityStartFn ?? sendLiveActivityStart;
  const resolvedApnsConfig =
    deps.apnsConfig === undefined ? readApnsConfig() : deps.apnsConfig;

  const resolvedSupabaseUrl = deps.supabaseUrl ?? SUPABASE_URL;
  const resolvedServiceRoleKey = deps.supabaseServiceRoleKey ?? SUPABASE_SERVICE_ROLE_KEY;
  const resolvedVapidPublic = deps.vapidPublicKey ?? VAPID_PUBLIC_KEY;
  const resolvedVapidPrivate = deps.vapidPrivateKey ?? VAPID_PRIVATE_KEY;

  return async function handleNotificationsCronRequest(req: Request): Promise<Response> {
    const context = createEdgeRequestContext(req, "notifications-cron");
    const telemetry = createEdgeTelemetry(context);
    const requestSpan = telemetry.startSpan("edge.notifications_cron.request", {
      kind: "server",
      attrs: {
        request_method: req.method,
      },
    });
    const emit = (
      level: "debug" | "info" | "warn" | "error",
      message: string,
      attrs?: Record<string, boolean | number | string | null>,
    ) => {
      if (level === "debug") telemetry.debug(message, attrs);
      if (level === "info") telemetry.info(message, attrs);
      if (level === "warn") telemetry.warn(message, attrs);
      if (level === "error") telemetry.error(message, attrs);
    };

    emit("info", "notifications_cron_invocation_started", {
      request_method: req.method,
    });

    if (req.method === "OPTIONS") {
      await requestSpan.end({ status: "ok", attrs: { cors_preflight: true } });
      return new Response("ok", { headers: corsHeaders });
    }

    if (!resolvedSupabaseUrl || !resolvedServiceRoleKey) {
      log.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      emit("error", "notifications_cron_missing_supabase_config");
      await requestSpan.end({
        status: "error",
        statusMessage: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const supabase = createClientFn<Database>(resolvedSupabaseUrl, resolvedServiceRoleKey);
    const now = deps.now ? deps.now() : new Date();
    const rpcWithTelemetry = async <
      TArgs extends Record<string, unknown>,
      TName extends keyof Database["public"]["Functions"],
    >(
      rpcName: TName,
      args: TArgs,
    ): Promise<{ data: unknown; error: unknown }> => {
      const rpcSpan = telemetry.startSpan(`edge.notifications_cron.rpc.${String(rpcName)}`, {
        kind: "client",
        attrs: {
          rpc_name: String(rpcName),
        },
      });
      emit("debug", "notifications_cron_rpc_started", {
        rpc_name: String(rpcName),
      });
      const result = await supabase.rpc(rpcName, args);
      const hasError = Boolean(result.error);
      if (hasError) {
        emit("warn", "notifications_cron_rpc_failed", {
          rpc_name: String(rpcName),
          error_message:
            result.error && typeof result.error === "object" && "message" in result.error
              ? String((result.error as { message?: unknown }).message ?? "Unknown RPC error")
              : "Unknown RPC error",
        });
      }
      await rpcSpan.end({
        status: hasError ? "error" : "ok",
        statusMessage:
          hasError && result.error && typeof result.error === "object" && "message" in result.error
            ? String((result.error as { message?: unknown }).message ?? "RPC failed")
            : undefined,
      });
      return result as { data: unknown; error: unknown };
    };

    const subscriptionSpan = telemetry.startSpan("edge.notifications_cron.load_subscriptions");
    const [{ data: subs }, { data: liveTokenOwners }] = await Promise.all([
      supabase.from("push_subscriptions").select("auth_user_id"),
      supabase.from("live_activity_tokens").select("auth_user_id"),
    ]);
    const userIds = [
      ...new Set([
        ...(subs ?? []).map((row: { auth_user_id: string }) => row.auth_user_id),
        ...(liveTokenOwners ?? []).map((row: { auth_user_id: string }) => row.auth_user_id),
      ]),
    ];
    await subscriptionSpan.end({
      status: "ok",
      attrs: {
        user_count: userIds.length,
        push_subscriber_count: (subs ?? []).length,
        live_activity_owner_count: (liveTokenOwners ?? []).length,
      },
    });
    if (userIds.length === 0) {
      emit("info", "notifications_cron_no_subscriptions");
      await requestSpan.end({
        status: "ok",
        attrs: {
          processed: 0,
        },
      });
      return jsonResponse({ ok: true, processed: 0 }, 200);
    }

    const digestSpan = telemetry.startSpan("edge.notifications_cron.create_medication_digests");
    await rpcWithTelemetry("create_medication_reminder_digests", {
      p_now_timestamptz: now.toISOString(),
    });
    await digestSpan.end({ status: "ok" });

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
      const userSpan = telemetry.startSpan("edge.notifications_cron.user_loop");
      const prefs = prefsByUser.get(authUserId) ?? { ...defaultPrefs, auth_user_id: authUserId };
      const timeStr = prefs.checkup_notification_time ?? "09:00";
      const tz = prefs.checkup_notification_timezone ?? undefined;
      const inWindow = isNotificationWindowForUser(now, timeStr, tz ?? null);

      const { data: routedPersons } = await rpcWithTelemetry("get_routed_persons_for_recipient", {
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
        const { data: payloadRows } = await rpcWithTelemetry(
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
            const { data: payloadRows } = await rpcWithTelemetry(
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

      if (notificationsForUser.length === 0) {
        await userSpan.end({
          status: "ok",
          attrs: {
            in_window: inWindow,
            notification_count: 0,
            processed,
          },
        });
        continue;
      }

      const { data: userSubs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth, suppress_medication_push")
        .eq("auth_user_id", authUserId);

      const medicationGroups = aggregateMedicationNotifications(notificationsForUser);
      let apnsDelivered = false;

      if (medicationGroups.length > 0) {
        const { data: liveTokens } = await supabase
          .from("live_activity_tokens")
          .select("push_to_start_token, bundle_id, apns_environment")
          .eq("auth_user_id", authUserId);

        if ((liveTokens as LiveActivityTokenRow[] | null)?.length) {
          const apnsSpan = telemetry.startSpan("edge.notifications_cron.send_live_activity", {
            attrs: {
              token_count: (liveTokens as LiveActivityTokenRow[]).length,
              medication_group_count: medicationGroups.length,
              apns_configured: resolvedApnsConfig !== null,
            },
          });

          if (resolvedApnsConfig === null) {
            // Inert without secrets: one debug line, never an error, Web Push stays the path.
            emit("debug", "notifications_cron_apns_skipped_missing_secrets");
            await apnsSpan.end({
              status: "ok",
              attrs: { skipped: true, reason: "missing_apns_secrets" },
            });
          } else {
            try {
              for (const tokenRow of liveTokens as LiveActivityTokenRow[]) {
                for (const group of medicationGroups) {
                  const first = group.medItems[0];
                  const payload: LiveActivityStartPayload = {
                    medicationName: first?.medicationName ?? group.title,
                    amountLabel: first?.amount
                      ? `${first.amount} ${first.unit}`
                      : (first?.body ?? group.title),
                    personPrefix: group.title_prefix,
                    dueAt: group.scheduledAt,
                    snoozeMinutes: 60,
                    doseEventIds: group.dose_event_ids,
                    alertTitle: group.title,
                    alertBody: group.medItems.map((item) => item.body).filter(Boolean).join("; "),
                  };
                  const result = await sendLiveActivity({
                    token: tokenRow.push_to_start_token,
                    environment: tokenRow.apns_environment,
                    payload,
                    config: resolvedApnsConfig,
                  });
                  if (result.ok) {
                    apnsDelivered = true;
                    emit("info", "notifications_cron_apns_delivered", {
                      apns_status: result.status,
                      apns_id: result.apnsId,
                      apns_environment: tokenRow.apns_environment,
                    });
                  } else if (!result.skipped) {
                    emit("warn", "notifications_cron_apns_failed", {
                      apns_status: result.status,
                      apns_id: result.apnsId,
                      apns_environment: tokenRow.apns_environment,
                    });
                    if (result.status === 410) {
                      await supabase
                        .from("live_activity_tokens")
                        .delete()
                        .eq("push_to_start_token", tokenRow.push_to_start_token);
                    }
                  }
                }
              }
              await apnsSpan.end({ status: "ok", attrs: { apns_delivered: apnsDelivered } });
            } catch (error) {
              emit("warn", "notifications_cron_apns_exception", {
                error_message: error instanceof Error ? error.message : "Unknown APNs error",
              });
              await apnsSpan.end({
                status: "error",
                statusMessage: error instanceof Error ? error.message : "Unknown APNs error",
              });
            }
          }
        }
      }

      if (resolvedVapidPublic && resolvedVapidPrivate && userSubs?.length) {
        const pushSpan = telemetry.startSpan("edge.notifications_cron.send_push", {
          attrs: {
            subscription_count: userSubs.length,
            notification_count: notificationsForUser.length,
          },
        });
        try {
          webpushClient.setVapidDetails(
            "mailto:support@example.com",
            resolvedVapidPublic,
            resolvedVapidPrivate,
          );
          const payloadToSend = buildPushPayload(notificationsForUser);
          const hasMedication = medicationGroups.length > 0;

          for (const sub of userSubs as PushSubscriptionRow[]) {
            if (
              hasMedication &&
              apnsDelivered &&
              isAppleWebPushEndpoint(sub.endpoint) &&
              !sub.suppress_medication_push
            ) {
              // Suppress Apple Web Push only after a confirmed Live Activity delivery.
              continue;
            }
            if (hasMedication && sub.suppress_medication_push) {
              continue;
            }
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
          await pushSpan.end({ status: "ok" });
        } catch (error) {
          log.error("Web Push send failed:", error);
          emit("error", "notifications_cron_push_failed", {
            error_message: error instanceof Error ? error.message : "Unknown push error",
          });
          await pushSpan.end({
            status: "error",
            statusMessage: error instanceof Error ? error.message : "Unknown push error",
          });
        }
      }

      processed += 1;
      await userSpan.end({
        status: "ok",
        attrs: {
          in_window: inWindow,
          notification_count: notificationsForUser.length,
          processed,
        },
      });
    }

    await requestSpan.end({
      status: "ok",
      attrs: {
        processed,
      },
    });
    return jsonResponse({ ok: true, processed }, 200);
  };
}

export const handleRequest = createNotificationsCronHandler();
