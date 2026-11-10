import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { RoutingChoice } from "@/types/notification-routing";

/**
 * Checkup reminder time/timezone and per-person notification routing — the same
 * prefs the web and mobile settings screens edit. MCP exposes them so an agent
 * can read and change them without opening the phone.
 */

export interface CheckupReminderSettings {
  time: string;
  timezone: string | null;
}

export interface NotificationSettingsSnapshot {
  checkup_reminder: CheckupReminderSettings;
  routing: RoutingChoice[];
}

export interface UpdateNotificationSettingsInput {
  authUserId: string;
  checkupReminderTime?: string;
  checkupReminderTimezone?: string | null;
  routing?: RoutingChoice[];
}

function asHhMm(value: string | null | undefined): string {
  return value?.slice(0, 5) || "09:00";
}

export async function getNotificationSettings(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<NotificationSettingsSnapshot> {
  const [{ data: prefs, error: prefsError }, { data: routing, error: routingError }] =
    await Promise.all([
      supabase
        .from("user_preferences")
        .select("checkup_notification_time, checkup_notification_timezone")
        .eq("auth_user_id", authUserId)
        .maybeSingle(),
      supabase
        .from("notification_routing")
        .select("person_id, enabled, custom_prefix")
        .eq("recipient_user_id", authUserId)
        .order("created_at", { ascending: true }),
    ]);

  if (prefsError) throw new Error(prefsError.message);
  if (routingError) throw new Error(routingError.message);

  return {
    checkup_reminder: {
      time: asHhMm(prefs?.checkup_notification_time as string | null | undefined),
      timezone: (prefs?.checkup_notification_timezone as string | null | undefined) ?? null,
    },
    routing: ((routing as RoutingChoice[] | null) ?? []).map((row) => ({
      person_id: row.person_id,
      enabled: row.enabled,
      custom_prefix: row.custom_prefix ?? null,
    })),
  };
}

export async function updateNotificationSettings(
  supabase: SupabaseClient<Database>,
  input: UpdateNotificationSettingsInput,
): Promise<NotificationSettingsSnapshot> {
  const touchingPrefs =
    input.checkupReminderTime !== undefined || input.checkupReminderTimezone !== undefined;

  if (touchingPrefs) {
    const payload: {
      auth_user_id: string;
      checkup_notification_time?: string;
      checkup_notification_timezone?: string | null;
    } = { auth_user_id: input.authUserId };
    if (input.checkupReminderTime !== undefined) {
      payload.checkup_notification_time = input.checkupReminderTime;
    }
    if (input.checkupReminderTimezone !== undefined) {
      payload.checkup_notification_timezone = input.checkupReminderTimezone;
    }

    const { error } = await supabase
      .from("user_preferences")
      .upsert(payload, { onConflict: "auth_user_id" });
    if (error) throw new Error(error.message);
  }

  if (input.routing?.length) {
    for (const choice of input.routing) {
      const { error } = await supabase.from("notification_routing").upsert(
        {
          recipient_user_id: input.authUserId,
          person_id: choice.person_id,
          enabled: choice.enabled,
          custom_prefix: choice.custom_prefix ?? null,
        },
        { onConflict: "recipient_user_id,person_id" },
      );
      if (error) throw new Error(error.message);
    }
  }

  return getNotificationSettings(supabase, input.authUserId);
}
