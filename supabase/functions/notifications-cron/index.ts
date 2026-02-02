import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import webpush from "https://esm.sh/web-push@3.6.7";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * notifications-cron: Shared hourly cron for all notification types.
 *
 * Run every hour (e.g. 0 * * * *). For each user with push subscriptions and
 * user_preferences, if "now" in their timezone falls in the 30 minutes after
 * their configured notification time (e.g. 5:30 → 5:30–6:00):
 * 1. For each registered provider (checkup, etc.), call its RPC to get payloads
 * 2. Insert each into notification_digests with the provider type
 * 3. Send one data-only Web Push per user with all notifications
 *
 * To add a new type: add an entry to NOTIFICATION_PROVIDERS and implement
 * an RPC that returns (scheduled_at, title, body, url) for that type.
 *
 * Requires: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (or SUBSCRIPTION_VAPID_*)
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const VAPID_PUBLIC_KEY =
  Deno.env.get("VAPID_PUBLIC_KEY") ?? Deno.env.get("SUBSCRIPTION_VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY =
  Deno.env.get("VAPID_PRIVATE_KEY") ?? Deno.env.get("SUBSCRIPTION_VAPID_PRIVATE_KEY");

/** Providers called only when user is in their 30-min checkup window. RPC: (p_auth_user_id, p_date, p_notification_time, p_timezone). */
const NOTIFICATION_PROVIDERS_IN_WINDOW: { type: string; rpc: string }[] = [
  { type: "checkup", rpc: "get_checkup_notification_payload" },
];

/** Providers called every cron tick. Medication digests are created by create_medication_reminder_digests (called at start). */
const NOTIFICATION_PROVIDERS_EVERY_TICK: { type: string; rpc: string }[] = [];

interface PushSubscriptionRow {
  id: string;
  auth_user_id: string;
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
  scheduled_at: string;
  window_start?: string | null;
  window_end?: string | null;
  title: string;
  body: string;
  url: string;
  dose_event_id?: string | null;
  medication_name?: string | null;
  amount?: string | null;
  unit?: string | null;
  time_str?: string | null;
}

/** True if user's local time is within 30 minutes after their configured notification time (e.g. 5:30 → 5:30–6:00). */
function isNotificationWindowForUser(
  now: Date,
  notificationTime: string,
  timezone: string | null
): boolean {
  const parts = notificationTime.split(":").map(Number);
  const hour = parts[0] ?? 9;
  const min = parts[1] ?? 0;
  const userNow = timezone
    ? new Date(now.toLocaleString("en-US", { timeZone: timezone }))
    : now;
  const userMinutes = userNow.getHours() * 60 + userNow.getMinutes();
  const windowStart = hour * 60 + min;
  const windowEnd = windowStart + 30;
  if (windowEnd <= 24 * 60) {
    return userMinutes >= windowStart && userMinutes < windowEnd;
  }
  // Window spans midnight (e.g. 23:45 → 23:45–00:15)
  return userMinutes >= windowStart || userMinutes < (windowEnd % (24 * 60));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();

  const { data: subs } = await supabase.from("push_subscriptions").select("auth_user_id");
  const userIds = [...new Set((subs ?? []).map((s: { auth_user_id: string }) => s.auth_user_id))];
  if (userIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.rpc("create_medication_reminder_digests", {
    p_now_timestamptz: now.toISOString(),
  });

  const { data: prefsRows } = await supabase
    .from("user_preferences")
    .select("auth_user_id, checkup_notification_time, checkup_notification_timezone")
    .in("auth_user_id", userIds);

  const prefsByUser = new Map<string, UserPrefsRow>();
  for (const p of prefsRows ?? []) {
    prefsByUser.set(p.auth_user_id, p as UserPrefsRow);
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

    // Load all unsent digests (medication digests created by create_medication_reminder_digests at start).
    // One row per dose — do not limit; we need every dose (e.g. 2 from one med + 1 from another = 3 rows).
    const { data: unsentRows } = await supabase
      .from("notification_digests")
      .select("id, type, scheduled_at, payload_json")
      .eq("auth_user_id", authUserId)
      .is("sent_at", null)
      .order("scheduled_at", { ascending: true })
      .limit(1000);

    const notificationsForUser: {
      id: string;
      type: string;
      title: string;
      body: string;
      url: string;
      scheduledAt: string;
      dose_event_id?: string | null;
      isOverdueReminder?: boolean;
      medicationName?: string | null;
      amount?: string | null;
      unit?: string | null;
      timeStr?: string | null;
    }[] = [];
    for (const r of unsentRows ?? []) {
      const p = r.payload_json as {
        title?: string;
        body?: string;
        url?: string;
        dose_event_id?: string;
        medication_name?: string;
        amount?: string;
        unit?: string;
        time_str?: string;
        is_overdue_reminder?: boolean;
        doses?: Array<{
          dose_event_id?: string;
          medication_name?: string;
          amount?: string;
          unit?: string;
          time_str?: string;
          body?: string;
          is_overdue_reminder?: boolean;
        }>;
      };
      const type = r.type as string;
      const scheduledAt = r.scheduled_at as string;
      if (type === "medication" || type === "medication_snoozed") {
        const doses = Array.isArray(p?.doses) ? p.doses : null;
        if (doses && doses.length > 0) {
          for (const dose of doses) {
            notificationsForUser.push({
              id: r.id,
              type,
              title: p?.title ?? "",
              body: dose?.body ?? p?.body ?? "",
              url: p?.url ?? "/",
              scheduledAt,
              dose_event_id: dose?.dose_event_id ?? null,
              isOverdueReminder: dose?.is_overdue_reminder === true,
              medicationName: dose?.medication_name ?? null,
              amount: dose?.amount ?? null,
              unit: dose?.unit ?? null,
              timeStr: dose?.time_str ?? null,
            });
          }
        } else {
          notificationsForUser.push({
            id: r.id,
            type,
            title: p?.title ?? "",
            body: p?.body ?? "",
            url: p?.url ?? "/",
            scheduledAt,
            dose_event_id: p?.dose_event_id ?? null,
            isOverdueReminder: p?.is_overdue_reminder === true,
            medicationName: p?.medication_name ?? null,
            amount: p?.amount ?? null,
            unit: p?.unit ?? null,
            timeStr: p?.time_str ?? null,
          });
        }
        continue;
      }
      // Refill digests: send only once per day during the user's reminder window (same as checkup time).
      if (type === "medication_refill" && !inWindow) continue;
      notificationsForUser.push({
        id: r.id,
        type,
        title: p?.title ?? "",
        body: p?.body ?? "",
        url: p?.url ?? "/",
        scheduledAt,
        dose_event_id: p?.dose_event_id ?? null,
      });
    }

    const seenIds = new Set(notificationsForUser.map((n) => n.id));

    const processPayloadRows = async (
      provider: { type: string; rpc: string },
      payloadRows: PayloadRow[] | null
    ) => {
      if (!payloadRows || !Array.isArray(payloadRows) || payloadRows.length === 0) return;
      for (const payloadRow of payloadRows as PayloadRow[]) {
        const windowStart = payloadRow.window_start ?? null;
        const windowEnd = payloadRow.window_end ?? null;

        let digestId: string;
        let scheduledAt: string;
        let payloadJson: {
          title: string;
          body: string;
          url: string;
          dose_event_id?: string;
          medication_name?: string;
          amount?: string;
          unit?: string;
          time_str?: string;
        };

        if (windowStart != null && windowEnd != null) {
          const { data: existing } = await supabase
            .from("notification_digests")
            .select("id, scheduled_at, payload_json, sent_at")
            .eq("auth_user_id", authUserId)
            .eq("type", provider.type)
            .lt("window_start", windowEnd)
            .gt("window_end", windowStart)
            .maybeSingle();

          if (existing) {
            if (existing.sent_at != null) {
              continue;
            }
            digestId = existing.id;
            scheduledAt = existing.scheduled_at as string;
            payloadJson = existing.payload_json as { title: string; body: string; url: string };
          } else {
            const { data: digest, error: insertErr } = await supabase
              .from("notification_digests")
              .insert({
                auth_user_id: authUserId,
                type: provider.type,
                scheduled_at: payloadRow.scheduled_at,
                window_start: windowStart,
                window_end: windowEnd,
                payload_json: {
                  title: payloadRow.title,
                  body: payloadRow.body,
                  url: payloadRow.url,
                },
              })
              .select("id")
              .single();

            if (insertErr) {
              console.error(`Insert notification_digest failed (${provider.type}):`, insertErr);
              continue;
            }
            digestId = digest.id;
            scheduledAt = payloadRow.scheduled_at;
            payloadJson = { title: payloadRow.title, body: payloadRow.body, url: payloadRow.url };
          }
        } else {
          const { data: digest, error: insertErr } = await supabase
            .from("notification_digests")
            .insert({
              auth_user_id: authUserId,
              type: provider.type,
              scheduled_at: payloadRow.scheduled_at,
              payload_json: {
                title: payloadRow.title,
                body: payloadRow.body,
                url: payloadRow.url,
              },
            })
            .select("id")
            .single();

          if (insertErr) {
            console.error(`Insert notification_digest failed (${provider.type}):`, insertErr);
            continue;
          }
          digestId = digest.id;
          scheduledAt = payloadRow.scheduled_at;
          payloadJson = { title: payloadRow.title, body: payloadRow.body, url: payloadRow.url };
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
          });
        }
      }
    };

    for (const provider of NOTIFICATION_PROVIDERS_EVERY_TICK) {
      const { data: payloadRows } = await supabase.rpc(provider.rpc, {
        p_auth_user_id: authUserId,
        p_now_timestamptz: now.toISOString(),
        p_timezone: tz ?? null,
      });
      await processPayloadRows(provider, payloadRows as PayloadRow[] | null);
    }

    if (inWindow) {
      const dateStr = tz
        ? new Date(now.toLocaleString("en-US", { timeZone: tz })).toISOString().slice(0, 10)
        : now.toISOString().slice(0, 10);
      for (const provider of NOTIFICATION_PROVIDERS_IN_WINDOW) {
        const { data: payloadRows } = await supabase.rpc(provider.rpc, {
          p_auth_user_id: authUserId,
          p_date: dateStr,
          p_notification_time: timeStr,
          p_timezone: tz ?? null,
        });
        await processPayloadRows(provider, payloadRows as PayloadRow[] | null);
      }
    }

    if (notificationsForUser.length === 0) continue;

    const { data: userSubs } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("auth_user_id", authUserId);

    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && userSubs?.length) {
      try {
        webpush.setVapidDetails(
          "mailto:support@example.com",
          VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY
        );
        const medItemsFromDigests = notificationsForUser.filter(
          (n) => n.type === "medication" || n.type === "medication_snoozed"
        );
        const nonMedItems = notificationsForUser.filter(
          (n) => n.type !== "medication" && n.type !== "medication_snoozed"
        );
        let aggregatedMed: {
            id: string;
            ids: string[];
            type: "medication";
            title: string;
            medItems: { medicationName: string | null; amount: string | null; unit: string; body: string }[];
            url: string;
            scheduledAt: string;
            dose_event_ids: string[];
          } | null = null;
        // Build aggregated payload from unsent digests. Supports (1) one digest per user with
        // payload.doses array (all doses in one row) and (2) legacy one digest per dose.
        if (medItemsFromDigests.length > 0) {
          aggregatedMed = {
            id: medItemsFromDigests[0].id,
            ids: medItemsFromDigests.map((n) => n.id),
            type: "medication" as const,
            title: "Medications",
            medItems: medItemsFromDigests.map((n) => ({
              medicationName: n.medicationName ?? null,
              amount: n.amount ?? null,
              unit: n.unit ?? "pill",
              body:
                n.body ||
                (n.medicationName && n.timeStr
                  ? `${n.amount ?? "1"} ${n.unit ?? "pill"} · ${n.timeStr}`
                  : ""),
            })),
            url: "/health/medications",
            scheduledAt: medItemsFromDigests[0].scheduledAt,
            dose_event_ids: medItemsFromDigests
              .map((n) => n.dose_event_id)
              .filter((id): id is string => id != null && id !== ""),
          };
        }
        const payloadToSend = [
          ...(aggregatedMed ? [aggregatedMed] : []),
          ...nonMedItems.map((n) => {
            const base = {
              id: n.id,
              type: n.type,
              title: n.title,
              body: n.body,
              url: n.url,
              scheduledAt: n.scheduledAt,
              ...(n.dose_event_id != null
                ? { dose_event_id: n.dose_event_id, dose_event_ids: [n.dose_event_id] }
                : {}),
            };
            return base;
          }),
        ];
        for (const sub of userSubs as PushSubscriptionRow[]) {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              JSON.stringify({ notifications: payloadToSend }),
              { TTL: 86400 }
            );
          } catch (e) {
            if (
              e &&
              typeof e === "object" &&
              "statusCode" in e &&
              (e.statusCode === 410 || e.statusCode === 404)
            ) {
              await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
            }
          }
        }
        const sentDigestIds = [...new Set(notificationsForUser.map((n) => n.id))];
        if (sentDigestIds.length > 0) {
          await supabase
            .from("notification_digests")
            .update({ sent_at: now.toISOString() })
            .in("id", sentDigestIds);
        }
        const doseEventIdsToMarkSent = notificationsForUser
          .filter((n) => n.type === "medication" && n.dose_event_id && !n.isOverdueReminder)
          .map((n) => n.dose_event_id as string);
        if (doseEventIdsToMarkSent.length > 0) {
          await supabase
            .from("med_dose_events")
            .update({ status: "sent", updated_at: new Date().toISOString() })
            .in("id", doseEventIdsToMarkSent);
        }
      } catch (e) {
        console.error("Web Push send failed:", e);
      }
    }
    processed++;
  }

  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
