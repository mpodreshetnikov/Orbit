import { supabase } from "@/lib/supabase";
import { localDayBounds } from "@/features/doses/day";
import { LISTED_STATUSES, type DayDose } from "@/features/doses/model";

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

const DOSE_COLUMNS =
  "id, regimen_id, actual_at, taken_at, status, planned_intake, regimen:med_regimens(custom_name, intake_unit, intake_advice_type, intake_advice_text, schedule)";

/**
 * One local day's dose events for a person, earliest first.
 *
 * Filters on `actual_at` rather than `scheduled_at`, as the web app's `fetchDoseEventsForPerson`
 * does: a snoozed dose moves, and the list should follow it to where it is now due rather than
 * leaving it at the time it was first planned for.
 */
export async function fetchDosesForDay(personId: string, day: Date): Promise<DayDose[]> {
  const { startIso, endIso } = localDayBounds(day);

  const { data, error } = await supabase
    .from("med_dose_events")
    .select(DOSE_COLUMNS)
    .eq("person_id", personId)
    .is("deleted_at", null)
    .gte("actual_at", startIso)
    .lt("actual_at", endIso)
    .in("status", LISTED_STATUSES)
    .order("actual_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as DayDose[];
}

/**
 * Every dose of one course that has happened or should have, latest first.
 *
 * The web app's `fetchDoseEventsForRegimen`: settled doses, plus open ones whose time has passed —
 * a dose still ahead is not history yet. Ordered by when it was actually taken where it was.
 */
export async function fetchDoseHistory(
  regimenId: string,
  now: Date = new Date(),
): Promise<DayDose[]> {
  const { data, error } = await supabase
    .from("med_dose_events")
    .select(DOSE_COLUMNS)
    .eq("regimen_id", regimenId)
    .is("deleted_at", null)
    .in("status", LISTED_STATUSES)
    .order("actual_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }
  const nowIso = now.toISOString();
  const doses = ((data ?? []) as DayDose[]).filter(
    (dose) =>
      dose.status === "taken" ||
      dose.status === "skipped" ||
      dose.status === "missed" ||
      dose.actual_at < nowIso,
  );
  const at = (dose: DayDose) => dose.taken_at ?? dose.actual_at;
  return doses.sort((a, b) => at(b).localeCompare(at(a)));
}

/**
 * Record a dose as taken, now.
 *
 * Through `mark_dose_taken`, the function the web app calls, so stock is decremented and the dose's
 * reminders stop exactly as they do when it is marked there. `p_taken_at` is sent explicitly, as the
 * web dashboard sends it, so the moment recorded is the tap rather than whenever the request lands.
 */
export async function markDoseTaken(doseId: string, takenAt: string): Promise<void> {
  const { error } = await supabase.rpc("mark_dose_taken", {
    p_dose_event_id: doseId,
    p_taken_at: takenAt,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Record a dose as skipped, through the web app's `mark_dose_skipped`. */
export async function markDoseSkipped(doseId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_dose_skipped", { p_dose_event_id: doseId });
  if (error) {
    throw new Error(error.message);
  }
}

/** Put a taken or skipped dose back to open, through the web app's `undo_dose_intake`, which also
 * returns any stock the intake took. */
export async function undoDoseIntake(doseId: string): Promise<void> {
  const { error } = await supabase.rpc("undo_dose_intake", { p_dose_event_id: doseId });
  if (error) {
    throw new Error(error.message);
  }
}
