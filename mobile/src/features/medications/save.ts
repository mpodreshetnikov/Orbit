import {
  isAddOneTimeToExistingPayload,
  plannedIntakeFor,
  type MedRegimen,
  toPositiveAmount,
  type AddOneTimeToExistingPayload,
  type CreateMedRegimenInput,
} from "@orbit-types/regimen";
import type { CourseColumns } from "@orbit-types/regimen-form";
import type { Database } from "@db";
import { supabase } from "@/lib/supabase";

type CourseRow = Database["public"]["Tables"]["med_regimens"];

/**
 * Saving a course from the phone, step for step as the web app's new and edit pages save it: the
 * row through the same columns, a one-off intake as a taken dose, and the doses ahead regenerated
 * after a regular course changes, so "Сегодня" shows the new schedule at once.
 */

/** How many days ahead the generator fills, as the web app's regenerate route asks it to. */
const HORIZON_DAYS = 7;

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function insertCourse(input: CreateMedRegimenInput): Promise<MedRegimen> {
  const { data, error } = await supabase
    .from("med_regimens")
    // The columns are the shared builders' own, already in the shape the row stores.
    .insert({ status: "active", intake_unit: "pill", ...input } as unknown as CourseRow["Insert"])
    .select()
    .single();
  check(error);
  return data as unknown as MedRegimen;
}

/**
 * One intake taken into a course: a dose that carries the course's strength as it stands now, then
 * marked taken, which also moves its stock — the web app's `addOneTimeDoseToRegimen`.
 */
export async function addOneTimeDose(
  personId: string,
  payload: Omit<AddOneTimeToExistingPayload, "addToRegimenId">,
  regimenId: string,
): Promise<void> {
  const { data: course, error: courseError } = await supabase
    .from("med_regimens")
    .select("dose_definition")
    .eq("id", regimenId)
    .maybeSingle();
  check(courseError);
  const { data: dose, error: insertError } = await supabase
    .from("med_dose_events")
    .insert({
      person_id: personId,
      regimen_id: regimenId,
      scheduled_at: payload.scheduled_at,
      actual_at: payload.scheduled_at,
      planned_intake: plannedIntakeFor(
        course as Pick<MedRegimen, "dose_definition"> | null,
        payload.amount,
        payload.unit,
      ),
      status: "scheduled",
    })
    .select("id")
    .single();
  check(insertError);
  const note = payload.notes?.trim();
  const { error } = await supabase.rpc("mark_dose_taken", {
    p_dose_event_id: (dose as { id: string }).id,
    ...(note ? { p_note: note } : {}),
  });
  check(error);
}

/**
 * The doses ahead, cleared and generated again in the phone's time zone — what the web app's
 * `/api/medications/regenerate-events` does for one person. The zone is remembered as the
 * account's, as there, so reminders follow the person to wherever they last saved a course.
 */
export async function regenerateDoses(userId: string, personId: string): Promise<void> {
  // The phone's own zone: the day a dose falls on is the person's, not the server's.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await supabase
    .from("user_preferences")
    .upsert(
      { auth_user_id: userId, checkup_notification_timezone: timezone },
      { onConflict: "auth_user_id" },
    );
  await supabase.rpc("clear_future_med_dose_events_for_person", {
    p_person_id: personId,
    p_horizon_days: HORIZON_DAYS,
  });
  const { error } = await supabase.rpc("generate_med_dose_events_for_horizon_for_person", {
    p_person_id: personId,
    p_timezone: timezone,
    p_horizon_days: HORIZON_DAYS,
  });
  check(error);
}

/**
 * Save what the new-course form produced, and say which course to open afterwards: the course an
 * intake went into, the one-off course made for it, or the new regular course.
 */
export async function saveNewCourse(
  userId: string,
  personId: string,
  submission: CreateMedRegimenInput | AddOneTimeToExistingPayload,
): Promise<string> {
  if (isAddOneTimeToExistingPayload(submission)) {
    const { addToRegimenId, ...intake } = submission;
    await addOneTimeDose(personId, intake, addToRegimenId);
    return addToRegimenId;
  }
  if (submission.schedule.mode === "one_off") {
    // The note belongs to the intake, not to the course made to hold it.
    const course = await insertCourse({ ...submission, notes: null });
    await addOneTimeDose(
      personId,
      {
        scheduled_at: submission.schedule.due_at,
        amount: toPositiveAmount(submission.dose_definition?.intake?.amount),
        unit: submission.intake_unit ?? "pill",
        notes: submission.notes,
      },
      course.id,
    );
    return course.id;
  }
  const course = await insertCourse(submission);
  await regenerateDoses(userId, personId);
  return course.id;
}

/** Save an edited course, then regenerate its person's doses as the web edit page does. */
export async function saveEditedCourse(
  userId: string,
  course: Pick<MedRegimen, "id" | "person_id">,
  columns: CourseColumns,
): Promise<void> {
  const { error } = await supabase
    .from("med_regimens")
    .update(columns as unknown as CourseRow["Update"])
    .eq("id", course.id);
  check(error);
  await regenerateDoses(userId, course.person_id);
}
