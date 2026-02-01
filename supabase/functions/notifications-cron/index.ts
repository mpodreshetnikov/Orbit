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

/** Providers called every cron tick (e.g. medication reminders). RPC: (p_auth_user_id, p_now_timestamptz, p_timezone). */
const NOTIFICATION_PROVIDERS_EVERY_TICK: { type: string; rpc: string }[] = [
  { type: "medication", rpc: "get_medication_dose_reminder_payload" },
];

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
  overdue_reminder_interval_minutes: number | null;
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

/** Due window for medication/snoozed: 1 minute before/after now (in UTC). */
function isInMedicationDueWindow(scheduledAtIso: string, now: Date): boolean {
  const t = new Date(scheduledAtIso).getTime();
  const low = now.getTime() - 60 * 1000;
  const high = now.getTime() + 60 * 1000;
  return t >= low && t <= high;
}

/** Overdue today (same calendar day in user TZ, scheduled_at < now) and interval elapsed since last send. Stops when next day starts. */
function isInMedicationOverdueWindow(
  scheduledAtIso: string,
  now: Date,
  timezone: string | null,
  intervalMinutes: number,
  overdueSentAtIso: string | null
): boolean {
  const tz = timezone ?? "UTC";
  const scheduled = new Date(scheduledAtIso);
  const userNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const userScheduled = new Date(scheduled.toLocaleString("en-US", { timeZone: tz }));
  const scheduledDateStr = userScheduled.getFullYear() + "-" + String(userScheduled.getMonth() + 1).padStart(2, "0") + "-" + String(userScheduled.getDate()).padStart(2, "0");
  const todayStr = userNow.getFullYear() + "-" + String(userNow.getMonth() + 1).padStart(2, "0") + "-" + String(userNow.getDate()).padStart(2, "0");
  if (scheduledDateStr !== todayStr || scheduled.getTime() >= now.getTime()) return false;
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  const ref = overdueSentAtIso ? new Date(overdueSentAtIso).getTime() : new Date(scheduledAtIso).getTime();
  return now.getTime() >= ref + intervalMs;
}

/** True if scheduled_at is overdue today (same calendar day in user TZ, scheduled_at < now). */
function isMedicationOverdueToday(scheduledAtIso: string, now: Date, timezone: string | null): boolean {
  const tz = timezone ?? "UTC";
  const scheduled = new Date(scheduledAtIso);
  const userNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const userScheduled = new Date(scheduled.toLocaleString("en-US", { timeZone: tz }));
  const scheduledDateStr = userScheduled.getFullYear() + "-" + String(userScheduled.getMonth() + 1).padStart(2, "0") + "-" + String(userScheduled.getDate()).padStart(2, "0");
  const todayStr = userNow.getFullYear() + "-" + String(userNow.getMonth() + 1).padStart(2, "0") + "-" + String(userNow.getDate()).padStart(2, "0");
  return scheduledDateStr === todayStr && scheduled.getTime() < now.getTime();
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

  const { data: prefsRows } = await supabase
    .from("user_preferences")
    .select("auth_user_id, checkup_notification_time, checkup_notification_timezone, overdue_reminder_interval_minutes")
    .in("auth_user_id", userIds);

  const prefsByUser = new Map<string, UserPrefsRow>();
  for (const p of prefsRows ?? []) {
    prefsByUser.set(p.auth_user_id, p as UserPrefsRow);
  }

  const defaultPrefs: UserPrefsRow = {
    auth_user_id: "",
    checkup_notification_time: "09:00",
    checkup_notification_timezone: null,
    overdue_reminder_interval_minutes: 30,
  };

  let processed = 0;
  for (const authUserId of userIds) {
    const prefs = prefsByUser.get(authUserId) ?? { ...defaultPrefs, auth_user_id: authUserId };
    const timeStr = prefs.checkup_notification_time ?? "09:00";
    const tz = prefs.checkup_notification_timezone ?? undefined;
    const inWindow = isNotificationWindowForUser(now, timeStr, tz ?? null);

    const intervalMinutes = prefs.overdue_reminder_interval_minutes ?? 30;

    // Start with existing unsent digests so we resend until marked delivered
    const { data: unsentRows } = await supabase
      .from("notification_digests")
      .select("id, type, scheduled_at, payload_json, overdue_sent_at")
      .eq("auth_user_id", authUserId)
      .is("sent_at", null)
      .order("scheduled_at", { ascending: true });

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
      };
      const type = r.type as string;
      const scheduledAt = r.scheduled_at as string;
      const overdueSentAt = (r as { overdue_sent_at?: string | null }).overdue_sent_at ?? null;
      if (type === "medication" || type === "medication_snoozed") {
        const inDue = isInMedicationDueWindow(scheduledAt, now);
        const inOverdue = isInMedicationOverdueWindow(scheduledAt, now, tz ?? null, intervalMinutes, overdueSentAt);
        if (!inDue && !inOverdue) continue;
        notificationsForUser.push({
          id: r.id,
          type,
          title: p?.title ?? "",
          body: p?.body ?? "",
          url: p?.url ?? "/",
          scheduledAt,
          dose_event_id: p?.dose_event_id ?? null,
          isOverdueReminder: inOverdue && !inDue,
          medicationName: p?.medication_name ?? null,
          amount: p?.amount ?? null,
          unit: p?.unit ?? null,
          timeStr: p?.time_str ?? null,
        });
        continue;
      }
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
        const doseEventId = payloadRow.dose_event_id ?? null;

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

        if (provider.type === "medication" && doseEventId) {
          const { data: existingByEvent } = await supabase
            .from("notification_digests")
            .select("id, scheduled_at, payload_json, sent_at")
            .eq("auth_user_id", authUserId)
            .eq("type", "medication")
            .is("sent_at", null)
            .filter("payload_json->>dose_event_id", "eq", doseEventId)
            .maybeSingle();

          if (existingByEvent) {
            if (existingByEvent.sent_at != null) continue;
            digestId = existingByEvent.id;
            scheduledAt = existingByEvent.scheduled_at as string;
            payloadJson = existingByEvent.payload_json as typeof payloadJson;
          } else {
            const medPayload: typeof payloadJson = {
              title: payloadRow.title,
              body: payloadRow.body,
              url: payloadRow.url,
              dose_event_id: doseEventId,
            };
            if (payloadRow.medication_name != null) medPayload.medication_name = payloadRow.medication_name;
            if (payloadRow.amount != null) medPayload.amount = payloadRow.amount;
            if (payloadRow.unit != null) medPayload.unit = payloadRow.unit;
            if (payloadRow.time_str != null) medPayload.time_str = payloadRow.time_str;
            const { data: digest, error: insertErr } = await supabase
              .from("notification_digests")
              .insert({
                auth_user_id: authUserId,
                type: "medication",
                scheduled_at: payloadRow.scheduled_at,
                window_start: windowStart,
                window_end: windowEnd,
                payload_json: medPayload,
              })
              .select("id")
              .single();

            if (insertErr) {
              console.error(`Insert notification_digest failed (${provider.type}):`, insertErr);
              continue;
            }
            digestId = digest.id;
            scheduledAt = payloadRow.scheduled_at;
            payloadJson = medPayload;
          }
          if (!seenIds.has(digestId)) {
            seenIds.add(digestId);
            const isOverdue = isMedicationOverdueToday(scheduledAt, now, tz ?? null);
            notificationsForUser.push({
              id: digestId,
              type: provider.type,
              title: payloadJson.title,
              body: payloadJson.body,
              url: payloadJson.url,
              scheduledAt,
              dose_event_id: doseEventId,
              isOverdueReminder: isOverdue,
              medicationName: payloadJson.medication_name ?? null,
              amount: payloadJson.amount ?? null,
              unit: payloadJson.unit ?? null,
              timeStr: payloadJson.time_str ?? null,
            });
          }
          continue;
        }

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
        const medItems = notificationsForUser.filter(
          (n) => n.type === "medication" || n.type === "medication_snoozed"
        );
        const nonMedItems = notificationsForUser.filter(
          (n) => n.type !== "medication" && n.type !== "medication_snoozed"
        );
        const aggregatedMed =
          medItems.length > 0
            ? {
                id: medItems[0].id,
                ids: medItems.map((n) => n.id),
                type: "medication" as const,
                title: "Medications",
                body: medItems
                  .map((n) => {
                    if (n.medicationName != null && n.amount != null) {
                      return `• ${n.medicationName} — ${n.amount} ${n.unit ?? "pill"}`;
                    }
                    return n.body;
                  })
                  .join("\n"),
                url: "/health/medications",
                scheduledAt: medItems[0].scheduledAt,
                dose_event_ids: medItems
                  .map((n) => n.dose_event_id)
                  .filter((id): id is string => id != null),
              }
            : null;
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
        const doseEventIdsToMarkSent = notificationsForUser
          .filter((n) => n.type === "medication" && n.dose_event_id && !n.isOverdueReminder)
          .map((n) => n.dose_event_id as string);
        if (doseEventIdsToMarkSent.length > 0) {
          await supabase
            .from("med_dose_events")
            .update({ status: "sent", updated_at: new Date().toISOString() })
            .in("id", doseEventIdsToMarkSent);
        }
        const overdueDigestIds = notificationsForUser
          .filter((n) => (n.type === "medication" || n.type === "medication_snoozed") && n.isOverdueReminder)
          .map((n) => n.id);
        if (overdueDigestIds.length > 0) {
          await supabase
            .from("notification_digests")
            .update({ overdue_sent_at: now.toISOString() })
            .in("id", overdueDigestIds);
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
