import { supabase } from "@/lib/supabase";

/**
 * What can be done to a course as a whole, written exactly as the web app's `use-regimens` hooks
 * write it, so a course archived or refilled from the phone is the same row the web page would leave.
 */

function check(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Archive a course: its status, then the doses still ahead of it, so nothing more is reminded. Taken,
 * skipped and missed doses stay, which is what keeps its history visible under "В архиве".
 */
export async function archiveRegimen(regimenId: string): Promise<void> {
  const { error } = await supabase
    .from("med_regimens")
    .update({ status: "archived" })
    .eq("id", regimenId);
  check(error);
  const { error: doses } = await supabase
    .from("med_dose_events")
    .delete()
    .eq("regimen_id", regimenId)
    .in("status", ["scheduled", "sent", "snoozed"])
    .gte("scheduled_at", new Date().toISOString());
  check(doses);
}

/** Bring a course back from the archive; the next regeneration schedules its doses again. */
export async function unarchiveRegimen(regimenId: string): Promise<void> {
  const { error } = await supabase
    .from("med_regimens")
    .update({ status: "active" })
    .eq("id", regimenId);
  check(error);
}

/** Delete a course softly, its doses first, as the web app does: nothing is removed from the table. */
export async function deleteRegimen(regimenId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error: doses } = await supabase
    .from("med_dose_events")
    .update({ deleted_at: now })
    .eq("regimen_id", regimenId);
  check(doses);
  const { error } = await supabase
    .from("med_regimens")
    .update({ deleted_at: now })
    .eq("id", regimenId);
  check(error);
}

/**
 * Add to a course's stock, or take from it: a positive amount is a refill and a negative one a
 * correction, the two kinds the web refill dialog writes.
 */
export async function changeStock(regimenId: string, amount: number): Promise<void> {
  const { error } = await supabase.rpc("update_regimen_inventory", {
    p_regimen_id: regimenId,
    p_type: amount > 0 ? "refill" : "correction",
    p_amount: amount,
  });
  check(error);
}

/** The day the low-stock reminder is put off until, as `YYYY-MM-DD`, or null when it is not. */
export async function fetchRefillSnooze(regimenId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_medication_refill_snooze", {
    p_regimen_id: regimenId,
  });
  check(error);
  return (data as string | null) ?? null;
}

/** Put the low-stock reminder off until `until` (`YYYY-MM-DD`), or bring it back with null. */
export async function setRefillSnooze(regimenId: string, until: string | null): Promise<void> {
  const { error } = await supabase.rpc("set_medication_refill_snooze", {
    p_regimen_id: regimenId,
    // The generated types narrow this nullable date to string; null is what clears it.
    p_snooze_until: until as string,
  });
  check(error);
}

/** The web app's default when the account has no preference row yet. */
export const DEFAULT_OVERDUE_INTERVAL = 30;

/** How often, in minutes, an overdue dose is reminded about again. */
export async function fetchOverdueInterval(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("overdue_reminder_interval_minutes")
    .eq("auth_user_id", userId)
    .maybeSingle();
  check(error);
  const row = data as { overdue_reminder_interval_minutes?: number | null } | null;
  return row?.overdue_reminder_interval_minutes ?? DEFAULT_OVERDUE_INTERVAL;
}

/** The web settings dialog's bounds: at least once a minute, at most once a day. */
export function clampOverdueInterval(minutes: number): number {
  return Math.max(1, Math.min(1440, Math.round(minutes)));
}

export async function saveOverdueInterval(userId: string, minutes: number): Promise<number> {
  const value = clampOverdueInterval(minutes);
  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      { auth_user_id: userId, overdue_reminder_interval_minutes: value },
      { onConflict: "auth_user_id" },
    );
  check(error);
  return value;
}
