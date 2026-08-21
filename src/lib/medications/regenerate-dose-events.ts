import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Clears future scheduled/sent dose events and regenerates them.
 *
 * Must run after any change to a regimen's schedule, dose or duration --
 * otherwise "Today's intakes" keeps showing the old plan. Extracted from
 * `src/app/api/medications/regenerate-events/route.ts` so the MCP medication
 * tools apply exactly the same invariant as the UI instead of a lookalike
 * reimplementation.
 *
 * Two behaviours here are deliberate and load-bearing:
 *  - A failed *clear* is tolerated (reported as 0 cleared), because a partial
 *    clear still leaves regeneration able to produce a correct forward plan.
 *  - A failed *generate* throws, because silently leaving a regimen with no
 *    upcoming intakes would look like the medication had been stopped.
 *
 * The timezone write-back matters too: pg_cron generates events server-side, so
 * if the client's timezone is not persisted, cron and the UI produce events at
 * different times and the user sees duplicates.
 */

export const DEFAULT_HORIZON_DAYS = 7;

export interface RegenerateDoseEventsResult {
  eventsCleared: number;
  eventsGenerated: number;
  timezone: string;
}

/**
 * The user's saved notification timezone, without touching it.
 *
 * `resolveTimezone` below *persists* what it is handed, which is right for the
 * callers that are re-timing the plan and wrong for anyone who only needs to
 * read a timestamp: `checkup_notification_timezone` drives
 * `run_med_event_generation_for_all_users` and both reminder digests, so
 * writing it moves every future dose event and checkup reminder in the
 * household.
 */
export async function readTimezonePreference(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("user_preferences")
    .select("checkup_notification_timezone")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  return data?.checkup_notification_timezone ?? null;
}

export async function resolveTimezone(
  supabase: SupabaseClient<Database>,
  params: { authUserId: string; requestedTimezone?: string | null },
): Promise<string> {
  const prefsTz = await readTimezonePreference(supabase, params.authUserId);

  const clientTz =
    typeof params.requestedTimezone === "string" && params.requestedTimezone.trim()
      ? params.requestedTimezone.trim()
      : null;

  const timezone = clientTz ?? prefsTz ?? "UTC";

  // Persist so the cron job generates at the same local times the user sees.
  if (clientTz && clientTz !== prefsTz) {
    await supabase
      .from("user_preferences")
      .upsert(
        { auth_user_id: params.authUserId, checkup_notification_timezone: clientTz },
        { onConflict: "auth_user_id" },
      );
  }

  return timezone;
}

export async function regenerateDoseEvents(
  supabase: SupabaseClient<Database>,
  params: {
    authUserId: string;
    personId?: string | null;
    timezone?: string | null;
    horizonDays?: number;
  },
): Promise<RegenerateDoseEventsResult> {
  const horizonDays = params.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const timezone = await resolveTimezone(supabase, {
    authUserId: params.authUserId,
    requestedTimezone: params.timezone,
  });

  const personId = params.personId?.trim() || null;

  if (personId) {
    const { data: cleared, error: clearError } = await supabase.rpc(
      "clear_future_med_dose_events_for_person",
      { p_person_id: personId, p_horizon_days: horizonDays },
    );
    const eventsCleared = !clearError && typeof cleared === "number" ? cleared : 0;

    const { data: generated, error: generateError } = await supabase.rpc(
      "generate_med_dose_events_for_horizon_for_person",
      { p_person_id: personId, p_timezone: timezone, p_horizon_days: horizonDays },
    );
    if (generateError) {
      throw new Error(`Event generator failed: ${generateError.message}`);
    }

    return {
      eventsCleared,
      eventsGenerated: typeof generated === "number" ? generated : 0,
      timezone,
    };
  }

  const { data: cleared, error: clearError } = await supabase.rpc("clear_future_med_dose_events", {
    p_auth_user_id: params.authUserId,
    p_horizon_days: horizonDays,
  });
  const eventsCleared = !clearError && typeof cleared === "number" ? cleared : 0;

  const { data: generated, error: generateError } = await supabase.rpc(
    "generate_med_dose_events_for_horizon",
    { p_auth_user_id: params.authUserId, p_timezone: timezone, p_horizon_days: horizonDays },
  );
  if (generateError) {
    throw new Error(`Event generator failed: ${generateError.message}`);
  }

  return {
    eventsCleared,
    eventsGenerated: typeof generated === "number" ? generated : 0,
    timezone,
  };
}
