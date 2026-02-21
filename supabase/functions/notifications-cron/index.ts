import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { corsHeaders } from "../_shared/cors.ts";
import type { Database } from "../_shared/database.types.ts";

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

/** Providers called only when user is in their 30-min checkup window. RPC: (p_person_id, p_date, p_notification_time, p_timezone). */
const NOTIFICATION_PROVIDERS_IN_WINDOW: { type: string; rpc: string }[] = [
  { type: "checkup", rpc: "get_checkup_notification_payload_for_person" },
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
  person_id?: string | null;
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

interface RoutedPersonRow {
  person_id: string;
  person_name: string;
  custom_prefix: string | null;
  person_owner_user_id: string | null;
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

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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
    const { data: routedPersons } = await supabase.rpc("get_routed_persons_for_recipient", {
      p_recipient_user_id: authUserId,
    });
    const routedPersonRows = (routedPersons ?? []) as RoutedPersonRow[];
    const personMetaById = new Map(
      routedPersonRows.map((p) => [p.person_id, p] as const)
    );

    // Load all unsent digests (medication digests created by create_medication_reminder_digests at start).
    // One row per dose — do not limit; we need every dose (e.g. 2 from one med + 1 from another = 3 rows).
    const { data: unsentRows } = await supabase
      .from("notification_digests")
      .select("id, type, scheduled_at, payload_json, person_id")
      .eq("auth_user_id", authUserId)
      .is("sent_at", null)
      .order("scheduled_at", { ascending: true })
      .limit(1000);

    const allowedPersonIds = new Set(routedPersonRows.map((p) => p.person_id));
    const filteredUnsentRows = (unsentRows ?? []).filter((row) => {
      const personId = row.person_id as string | null;
      if (!personId) return true;
      return allowedPersonIds.has(personId);
    });

    const notificationsForUser: {
      id: string;
      type: string;
      title: string;
      body: string;
      url: string;
      scheduledAt: string;
      personId?: string | null;
      personName?: string | null;
      titlePrefix?: string | null;
      dose_event_id?: string | null;
      isOverdueReminder?: boolean;
      medicationName?: string | null;
      amount?: string | null;
      unit?: string | null;
      timeStr?: string | null;
    }[] = [];
    for (const r of filteredUnsentRows) {
      const p = r.payload_json as {
        title?: string;
        body?: string;
        url?: string;
        person_id?: string;
        person_name?: string;
        title_prefix?: string;
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
      const personId = (r.person_id as string | null) ?? p?.person_id ?? null;
      const meta = personId ? personMetaById.get(personId) : null;
      const isOwnPerson = personId != null && meta?.person_owner_user_id === authUserId;
      const personName = p?.person_name ?? meta?.person_name ?? null;
      const hasExplicitTitlePrefix =
        p != null && Object.prototype.hasOwnProperty.call(p, "title_prefix");
      const rawTitlePrefix = hasExplicitTitlePrefix
        ? (p?.title_prefix ?? null)
        : (meta?.custom_prefix ?? personName ?? null);
      const titlePrefix = isOwnPerson ? null : rawTitlePrefix;
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
              personId,
              personName,
              titlePrefix,
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
            personId,
            personName,
            titlePrefix,
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
        personId,
        personName,
        titlePrefix,
        dose_event_id: p?.dose_event_id ?? null,
      });
    }

    const seenIds = new Set(notificationsForUser.map((n) => n.id));

    const processPayloadRows = async (
      provider: { type: string; rpc: string },
      payloadRows: PayloadRow[] | null,
      personMeta: RoutedPersonRow | null
    ) => {
      if (!payloadRows || !Array.isArray(payloadRows) || payloadRows.length === 0) return;
      for (const payloadRow of payloadRows as PayloadRow[]) {
        const windowStart = payloadRow.window_start ?? null;
        const windowEnd = payloadRow.window_end ?? null;
        const personId = payloadRow.person_id ?? personMeta?.person_id ?? null;
        const isOwnPerson = personId != null && personMeta?.person_owner_user_id === authUserId;
        const personName = personMeta?.person_name ?? null;
        const rawTitlePrefix = personMeta?.custom_prefix ?? personName ?? null;
        const titlePrefix = isOwnPerson ? null : rawTitlePrefix;

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

            if (insertErr) {
              console.error(`Insert notification_digest failed (${provider.type}):`, insertErr);
              continue;
            }
            digestId = digest.id;
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
          const { data: digest, error: insertErr } = await supabase
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

          if (insertErr) {
            console.error(`Insert notification_digest failed (${provider.type}):`, insertErr);
            continue;
          }
          digestId = digest.id;
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

    for (const provider of NOTIFICATION_PROVIDERS_EVERY_TICK) {
      const { data: payloadRows } = await supabase.rpc(provider.rpc as keyof Database["public"]["Functions"], {
        p_auth_user_id: authUserId,
        p_now_timestamptz: now.toISOString(),
        p_timezone: tz ?? null,
      });
      await processPayloadRows(provider, payloadRows as PayloadRow[] | null, null);
    }

    if (inWindow) {
      const dateStr = tz
        ? new Date(now.toLocaleString("en-US", { timeZone: tz })).toISOString().slice(0, 10)
        : now.toISOString().slice(0, 10);
      for (const provider of NOTIFICATION_PROVIDERS_IN_WINDOW) {
        for (const person of routedPersonRows) {
          const { data: payloadRows } = await supabase.rpc(provider.rpc as keyof Database["public"]["Functions"], {
            p_person_id: person.person_id,
            p_date: dateStr,
            p_notification_time: timeStr,
            p_timezone: tz ?? null,
          });
          await processPayloadRows(provider, payloadRows as PayloadRow[] | null, person);
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
        const medItemsFromDigests = notificationsForUser.filter(
          (n) => n.type === "medication" || n.type === "medication_snoozed"
        );
        const nonMedItems = notificationsForUser.filter(
          (n) => n.type !== "medication" && n.type !== "medication_snoozed"
        );
        const medGroups = new Map<
          string,
          {
            personId: string | null;
            personName: string | null;
            titlePrefix: string | null;
            ids: Set<string>;
            medItems: { medicationName: string | null; amount: string | null; unit: string; body: string }[];
            scheduledAt: string;
            doseEventIds: string[];
          }
        >();
        for (const n of medItemsFromDigests) {
          const key = n.personId ?? "unknown";
          const existing = medGroups.get(key);
          const medItem = {
            medicationName: n.medicationName ?? null,
            amount: n.amount ?? null,
            unit: n.unit ?? "pill",
            body:
              n.body ||
              (n.medicationName && n.timeStr
                ? `${n.amount ?? "1"} ${n.unit ?? "pill"} · ${n.timeStr}`
                : ""),
          };
          if (!existing) {
            medGroups.set(key, {
              personId: n.personId ?? null,
              personName: n.personName ?? null,
              titlePrefix: n.titlePrefix ?? null,
              ids: new Set([n.id]),
              medItems: [medItem],
              scheduledAt: n.scheduledAt,
              doseEventIds:
                n.dose_event_id != null && n.dose_event_id !== "" ? [n.dose_event_id] : [],
            });
          } else {
            existing.ids.add(n.id);
            existing.medItems.push(medItem);
            if (n.scheduledAt < existing.scheduledAt) {
              existing.scheduledAt = n.scheduledAt;
            }
            if (n.dose_event_id != null && n.dose_event_id !== "") {
              existing.doseEventIds.push(n.dose_event_id);
            }
          }
        }
        const aggregatedMeds = Array.from(medGroups.values()).map((group) => ({
          id: Array.from(group.ids)[0],
          ids: Array.from(group.ids),
          type: "medication" as const,
          title: "Medications",
          medItems: group.medItems,
          url: "/health/medications",
          scheduledAt: group.scheduledAt,
          dose_event_ids: group.doseEventIds,
          person_id: group.personId,
          person_name: group.personName,
          title_prefix: group.titlePrefix,
        }));
        const payloadToSend = [
          ...aggregatedMeds,
          ...nonMedItems.map((n) => {
            const base = {
              id: n.id,
              type: n.type,
              title: n.title,
              body: n.body,
              url: n.url,
              scheduledAt: n.scheduledAt,
              person_id: n.personId ?? null,
              person_name: n.personName ?? null,
              title_prefix: n.titlePrefix ?? null,
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
