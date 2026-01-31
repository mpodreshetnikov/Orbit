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

/** Provider: type identifier and RPC name. RPC must accept (p_auth_user_id, p_date, p_notification_time, p_timezone) and return rows with scheduled_at, title, body, url. */
const NOTIFICATION_PROVIDERS: { type: string; rpc: string }[] = [
  { type: "checkup", rpc: "get_checkup_notification_payload" },
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
}

interface PayloadRow {
  scheduled_at: string;
  window_start?: string | null;
  window_end?: string | null;
  title: string;
  body: string;
  url: string;
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
    .select("auth_user_id, checkup_notification_time, checkup_notification_timezone")
    .in("auth_user_id", userIds);

  const prefsByUser = new Map<string, UserPrefsRow>();
  for (const p of prefsRows ?? []) {
    prefsByUser.set(p.auth_user_id, p as UserPrefsRow);
  }

  let processed = 0;
  for (const authUserId of userIds) {
    const prefs = prefsByUser.get(authUserId);
    if (!prefs) continue;
    const timeStr = prefs.checkup_notification_time ?? "09:00";
    const tz = prefs.checkup_notification_timezone ?? undefined;
    const inWindow = isNotificationWindowForUser(now, timeStr, tz ?? null);

    // Start with existing unsent digests so we resend until marked delivered
    const { data: unsentRows } = await supabase
      .from("notification_digests")
      .select("id, type, scheduled_at, payload_json")
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
    }[] = (unsentRows ?? []).map((r) => {
      const p = r.payload_json as { title?: string; body?: string; url?: string };
      return {
        id: r.id,
        type: r.type,
        title: p?.title ?? "",
        body: p?.body ?? "",
        url: p?.url ?? "/",
        scheduledAt: r.scheduled_at as string,
      };
    });

    const seenIds = new Set(notificationsForUser.map((n) => n.id));

    if (inWindow) {
      const dateStr = tz
        ? new Date(now.toLocaleString("en-US", { timeZone: tz })).toISOString().slice(0, 10)
        : now.toISOString().slice(0, 10);

      for (const provider of NOTIFICATION_PROVIDERS) {
      const { data: payloadRows } = await supabase.rpc(provider.rpc, {
        p_auth_user_id: authUserId,
        p_date: dateStr,
        p_notification_time: timeStr,
        p_timezone: tz ?? null,
      });

      if (!payloadRows || !Array.isArray(payloadRows) || payloadRows.length === 0) continue;

      for (const payloadRow of payloadRows as PayloadRow[]) {
        const windowStart = payloadRow.window_start ?? null;
        const windowEnd = payloadRow.window_end ?? null;

        let digestId: string;
        let scheduledAt: string;
        let payloadJson: { title: string; body: string; url: string };

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
        for (const sub of userSubs as PushSubscriptionRow[]) {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              JSON.stringify({ notifications: notificationsForUser }),
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
