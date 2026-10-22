import type { MedicationKind } from "@orbit-types/medication";
import {
  firstUnitStrength,
  toPositiveAmount,
  type AddOneTimeToExistingPayload,
  type CreateMedRegimenInput,
  type MedRegimen,
} from "@orbit-types/regimen";
import {
  courseToAddTo,
  getInitialDuration,
  getInitialIntakeAdvice,
  getInitialSchedule,
  getInitialStartDate,
  oneTimeCourseColumns,
  oneTimeSubmission,
  regularCourseColumns,
  reminderTimesProblem,
  type CourseColumns,
  type CourseFormValues,
} from "@orbit-types/regimen-form";

/**
 * The course form's state and checks, apart from the screen that draws them: what the web form holds
 * in its dozen `useState`s, here as one object, opened on a course or on the web form's defaults.
 * What a save writes comes from the builders the web form uses, so both write the same columns.
 */

export type CourseForm = CourseFormValues & {
  kind: MedicationKind;
  /** The one-off intake's amount and moment. */
  oneTimeAmount: number;
  scheduledAt: Date | null;
  /** The course a one-off intake goes into, when one was picked by its name. */
  picked: string | null;
};

/** Which field a refused save points at, and the message key that says why. */
export type FormProblem = { field: "name" | "scheduledAt" | "duration" | "slots"; message: string };

/** The form opened on `initial`, or empty for a new course of the kind asked for. */
export function initialCourseForm(
  initial: MedRegimen | null,
  defaultKind: MedicationKind,
  now: Date,
): CourseForm {
  const strength = firstUnitStrength(initial?.dose_definition);
  const dueAt = initial?.schedule?.mode === "one_off" ? initial.schedule.due_at : "";
  const kind = initial
    ? initial.schedule?.mode === "one_off"
      ? "one_time"
      : "regular"
    : defaultKind;
  return {
    kind,
    name: initial?.custom_name ?? "",
    unit: initial?.intake_unit ?? "pill",
    strength: {
      name: strength?.name ?? "",
      amount: strength?.amount ?? null,
      unit: strength?.unit.trim() || "milligram",
    },
    intakeAdvice: getInitialIntakeAdvice(initial),
    intakeAdviceCustom: initial?.intake_advice_text ?? "",
    schedule: getInitialSchedule(initial, kind),
    duration: getInitialDuration(initial),
    startDate: getInitialStartDate(initial),
    inventory: {
      enabled: initial?.inventory?.enabled ?? false,
      current: (initial?.inventory?.current_amount ?? "").toString(),
      refillThreshold: (initial?.inventory?.refill_threshold_amount ?? "").toString(),
    },
    notes: initial?.notes ?? "",
    oneTimeAmount: toPositiveAmount(initial?.dose_definition?.intake?.amount),
    scheduledAt: dueAt ? new Date(dueAt) : initial ? null : now,
    picked: null,
  };
}

/** What stops a save, in the web form's order: the name, the moment, the days, the slot times. */
export function formProblem(form: CourseForm, creating: boolean): FormProblem | null {
  if (!form.name.trim()) return { field: "name", message: "medications.validationNameRequired" };
  if (form.kind === "one_time") {
    return creating && !form.scheduledAt
      ? { field: "scheduledAt", message: "medications.validationScheduledAtRequired" }
      : null;
  }
  if (form.duration.type === "for_days" && !(form.duration.days >= 1)) {
    return { field: "duration", message: "medications.daysCountRequired" };
  }
  const slots = reminderTimesProblem(form.schedule);
  return slots ? { field: "slots", message: slots } : null;
}

/** What creating saves: a regular course, a one-off course, or an intake into a course. */
export function newCourseSubmission(
  form: CourseForm,
  personId: string,
  courses: MedRegimen[] | undefined,
): CreateMedRegimenInput | AddOneTimeToExistingPayload {
  if (form.kind === "one_time") {
    return oneTimeSubmission(
      form,
      personId,
      form.oneTimeAmount,
      form.scheduledAt?.toISOString() ?? "",
      courseToAddTo(form.name, form.picked, courses),
    );
  }
  return { person_id: personId, status: "active", ...regularCourseColumns(form, null) };
}

/** What editing `initial` saves. */
export function editedCourseColumns(form: CourseForm, initial: MedRegimen): CourseColumns {
  return form.kind === "one_time"
    ? oneTimeCourseColumns(form, initial, form.oneTimeAmount, form.scheduledAt?.toISOString() ?? "")
    : regularCourseColumns(form, initial);
}

/** "08:30" on the day of `base`, for the time picker. */
export function timeOnDay(time: string, base: Date): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const day = new Date(base);
  day.setHours(hours || 0, minutes || 0, 0, 0);
  return day;
}

/** The picker's moment as a slot holds it: "08:30". */
export function slotTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** A stored `YYYY-MM-DD` at noon, so no time zone can move it to the day before. */
export function noonOf(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

/** A typed amount, comma or point; `null` while the field is blank or not yet a number. */
export function parseAmount(typed: string): number | null {
  const trimmed = typed.trim().replace(",", ".");
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? amount : null;
}
