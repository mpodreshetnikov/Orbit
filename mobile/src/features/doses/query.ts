import { supabase } from "@/lib/supabase";
import { localDayBounds } from "@/features/doses/day";
import type { DoseEventForDisplay } from "@/features/doses/present";

/** Which dose events belong on a day's list. `cancelled` is left out: it is not a thing to do, and
 * it is not a thing that was done. Matches `fetchDoseEventsForPerson` in the web app's
 * `src/hooks/use-regimens.ts` so the two surfaces cannot disagree about what a day contains. */
const LISTED_STATUSES = ["scheduled", "sent", "snoozed", "taken", "skipped", "missed"] as const;

export type OrbitPerson = { id: string; name: string };

/**
 * The person whose doses this app shows.
 *
 * Row-level security already limits `persons` to the signed-in household, so this picks within it:
 * the person the account belongs to when one is linked, otherwise the first human. The ordering is
 * the web app's — `kind` ascending puts humans before pets, because 'h' sorts before 'p'.
 *
 * A household with several people needs a switcher rather than a guess, and that is a later
 * milestone; until it exists this returns one person and the screen names them, so a wrong guess is
 * visible rather than silent.
 */
export async function resolveOwnPerson(authUserId: string | undefined): Promise<OrbitPerson> {
  const { data, error } = await supabase
    .from("persons")
    .select("id, name, kind, auth_user_id")
    .order("kind", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  const persons = data ?? [];
  if (persons.length === 0) {
    throw new Error("This account has no person records, so there are no medications to show.");
  }

  const own = authUserId ? persons.find((person) => person.auth_user_id === authUserId) : undefined;
  const chosen = own ?? persons[0];
  return { id: chosen.id, name: chosen.name };
}

/**
 * One local day's dose events for a person, earliest first.
 *
 * Filters on `actual_at` rather than `scheduled_at`, as the web app does: a snoozed dose moves, and
 * the list should follow it to where it is now due rather than leaving it at the time it was first
 * planned for.
 */
export async function fetchDosesForDay(
  personId: string,
  now: Date = new Date(),
): Promise<DoseEventForDisplay[]> {
  const { startIso, endIso } = localDayBounds(now);

  const { data, error } = await supabase
    .from("med_dose_events")
    .select("id, actual_at, status, planned_intake, regimen:med_regimens(custom_name)")
    .eq("person_id", personId)
    .is("deleted_at", null)
    .gte("actual_at", startIso)
    .lt("actual_at", endIso)
    .in("status", LISTED_STATUSES)
    .order("actual_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}
