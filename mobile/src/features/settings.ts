import type { RoutingChoice } from "@orbit-types/notification-routing";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";

export interface HouseholdPerson {
  id: string;
  name: string;
  kind: string;
  species: string | null;
  auth_user_id: string | null;
}

export interface CheckupReminders {
  time: string;
  timezone: string | null;
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

const chosenKey = (userId: string) => `orbit.person.${userId}`;

/** The person this phone was last switched to for the account, if it was. */
export async function readChosenPerson(userId: string): Promise<string | null> {
  return AsyncStorage.getItem(chosenKey(userId));
}

export async function writeChosenPerson(userId: string, personId: string): Promise<void> {
  await AsyncStorage.setItem(chosenKey(userId), personId);
}

/** The household as the settings list it: humans first, then pets, each by name. */
export async function fetchHousehold(): Promise<HouseholdPerson[]> {
  const rows = check(
    await supabase
      .from("persons")
      .select("id, name, kind, species, auth_user_id")
      .order("kind", { ascending: true })
      .order("name", { ascending: true }),
  );
  return (rows ?? []) as HouseholdPerson[];
}

/** When the daily checkup reminder comes, as the web settings keep it. */
export async function fetchCheckupReminders(userId: string): Promise<CheckupReminders> {
  const row = check(
    await supabase
      .from("user_preferences")
      .select("checkup_notification_time, checkup_notification_timezone")
      .eq("auth_user_id", userId)
      .maybeSingle(),
  ) as {
    checkup_notification_time?: string | null;
    checkup_notification_timezone?: string | null;
  } | null;
  return {
    time: row?.checkup_notification_time?.slice(0, 5) ?? "09:00",
    timezone: row?.checkup_notification_timezone ?? null,
  };
}

export async function saveCheckupReminders(userId: string, reminders: CheckupReminders) {
  check(
    await supabase.from("user_preferences").upsert(
      {
        auth_user_id: userId,
        checkup_notification_time: reminders.time,
        checkup_notification_timezone: reminders.timezone,
      },
      { onConflict: "auth_user_id" },
    ),
  );
}

/** Whose reminders reach the account, row by row. */
export async function fetchRouting(userId: string): Promise<RoutingChoice[]> {
  const rows = check(
    await supabase
      .from("notification_routing")
      .select("person_id, enabled, custom_prefix")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: true }),
  );
  return (rows ?? []) as RoutingChoice[];
}

export async function saveRouting(userId: string, choice: RoutingChoice) {
  check(
    await supabase
      .from("notification_routing")
      .upsert(
        { recipient_user_id: userId, ...choice },
        { onConflict: "recipient_user_id,person_id" },
      ),
  );
}
