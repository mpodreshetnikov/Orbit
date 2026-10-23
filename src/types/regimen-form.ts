// ============================================================================
// What the medication form edits and what it saves, shared by the web form and the iOS client's,
// so a course created or edited on either is the same row.
// ============================================================================

import type { MedicationKind, MedicationUnit } from "./medication";
import type {
  AddOneTimeToExistingPayload,
  CreateMedRegimenInput,
  MedDuration,
  MedRegimen,
  MedSchedule,
  MedScheduleDailyTimes,
  MedScheduleDaysOfWeek,
  MedScheduleIntervalDays,
  PlannedIntake,
  RegimenInventory,
} from "./regimen";
import { toPositiveAmount, withFormStrength } from "./regimen";

export const DEFAULT_SCHEDULE: MedSchedule = {
  mode: "daily_times",
  times: ["09:00"],
  amounts: [1],
};

export const DEFAULT_DURATION: MedDuration = { type: "endless" };

/** Schedules whose `times` carry a matching per-slot `amounts` array. */
export type MedSchedulePerSlot =
  | MedScheduleDailyTimes
  | MedScheduleIntervalDays
  | MedScheduleDaysOfWeek;

/**
 * True for the schedule modes that `generate_med_dose_events_for_person_ids.sql`
 * doses slot by slot, reading `amounts[i]` beside `times[i]` and falling back to
 * the course's base amount when a slot has none.
 */
export function hasPerSlotAmounts(s: MedSchedule): s is MedSchedulePerSlot {
  return s.mode === "daily_times" || s.mode === "interval_days" || s.mode === "days_of_week";
}

/**
 * `amounts` aligned one-to-one with `times`: overrides that exist are kept, and a
 * slot without one takes the base dose the generator would fall back to for it.
 */
export function alignAmounts(
  times: string[],
  amounts: number[] | undefined,
  base: number,
): number[] {
  return times.map((_, i) => toPositiveAmount(amounts?.[i], base));
}

// Preset intake times: morning (9AM), midday (12), late afternoon (3PM), evening (8PM), night (11PM), plus extras for 6–10
const PRESET_INTAKE_TIMES: string[] = [
  "09:00", // morning
  "12:00", // midday
  "15:00", // late afternoon
  "20:00", // evening
  "23:00", // night
  "07:00", // early morning
  "10:00", // mid morning
  "14:00", // afternoon
  "18:00", // late evening
  "21:00", // before bed
];

/** Order for 1–5 intakes: 1=morning, 2=morning+evening, 3=morning+late afternoon+evening, 4=+midday, 5=+night */
const INTAKES_1_TO_5_TIMES: string[] = ["09:00", "20:00", "15:00", "12:00", "23:00"];

/**
 * A time no slot uses yet. The generator inserts one event per regimen and minute,
 * so two slots at the same time would show two doses in the form and produce one.
 */
export function nextUnusedTime(times: string[]): string {
  const used = new Set(times);
  const preset = PRESET_INTAKE_TIMES.find((time) => !used.has(time));
  if (preset) return preset;
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const candidate = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  return "08:00";
}

/** Format a Date as YYYY-MM-DDTHH:mm for datetime-local input */
export function toDatetimeLocalString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function getReminderSlotsForIntakesPerDay(n: number): { time: string; amount: number }[] {
  if (n < 1 || n > 10) return [{ time: "09:00", amount: 1 }];
  if (n <= 5) {
    const times = INTAKES_1_TO_5_TIMES.slice(0, n).sort();
    return times.map((time) => ({ time, amount: 1 }));
  }
  const ordered = [...PRESET_INTAKE_TIMES].sort();
  return ordered.slice(0, n).map((time) => ({ time, amount: 1 }));
}

export function getInitialSchedule(
  initial: MedRegimen | null | undefined,
  defaultKind: MedicationKind | undefined,
): MedSchedule {
  if (!initial?.schedule) {
    return defaultKind === "one_time" ? { mode: "one_off", due_at: "" } : DEFAULT_SCHEDULE;
  }
  const s = initial.schedule;
  if (s.mode === "one_off") return { ...s };
  if (s.mode === "daily_times")
    return { mode: "daily_times", times: s.times ?? ["09:00"], amounts: s.amounts ?? [1] };
  if (s.mode === "interval_hours")
    return {
      mode: "interval_hours",
      interval: { every: s.interval?.every ?? 1 },
      amount: toPositiveAmount((s as { amount?: number }).amount),
    };
  if (s.mode === "interval_days") {
    const sd = s as {
      interval?: { every?: number };
      time_of_day?: string;
      times?: string[];
      amounts?: number[];
    };
    const times = sd.times?.length ? sd.times : [sd.time_of_day ?? "09:00"];
    const amounts = sd.amounts?.length ? sd.amounts : times.map(() => 1);
    return { mode: "interval_days", interval: { every: sd.interval?.every ?? 1 }, times, amounts };
  }
  if (s.mode === "days_of_week") {
    const sw = s as { days_of_week?: number[]; times?: string[]; amounts?: number[] };
    return {
      mode: "days_of_week",
      days_of_week: sw.days_of_week ?? [1, 2, 3, 4, 5],
      times: sw.times ?? ["09:00"],
      // Carried verbatim: the generator doses these per slot, so rewriting or
      // dropping them here silently replaces the course's weekly overrides.
      ...(sw.amounts?.length ? { amounts: [...sw.amounts] } : {}),
    };
  }
  return DEFAULT_SCHEDULE;
}

export function getInitialDuration(initial: MedRegimen | null | undefined): MedDuration {
  if (!initial?.duration) return DEFAULT_DURATION;
  const d = initial.duration;
  const start = (d as { start_date?: string }).start_date;
  if (d.type === "until_date")
    return { type: "until_date", end_date: d.end_date ?? "", start_date: start };
  if (d.type === "for_days") return { type: "for_days", days: d.days ?? 1, start_date: start };
  return { type: "endless", start_date: start };
}

export function getInitialStartDate(initial: MedRegimen | null | undefined): string {
  const start = initial?.duration && (initial.duration as { start_date?: string }).start_date;
  if (start) return start;
  return new Date().toISOString().slice(0, 10);
}

export const mapLegacyIntakeAdvice = (v: string | null | undefined): string => {
  if (!v) return "";
  const legacyToNew: Record<string, string> = {
    before_breakfast: "before_meal",
    before_lunch: "before_meal",
    before_dinner: "before_meal",
    before_bed: "before_bed",
    with_breakfast: "with_meal",
    with_lunch: "with_meal",
    with_dinner: "with_meal",
    after_breakfast: "after_meal",
    after_lunch: "after_meal",
    after_dinner: "after_meal",
  };
  return (
    legacyToNew[v] ??
    (["before_meal", "with_meal", "after_meal", "before_bed", "morning_fasting", "custom"].includes(
      v,
    )
      ? v
      : "")
  );
};

/** The advice a form opens on: a legacy value mapped to today's, "none" as no advice. */
export function getInitialIntakeAdvice(initial: MedRegimen | null | undefined): string {
  return (
    mapLegacyIntakeAdvice(initial?.intake_advice_type ?? null) ||
    (initial?.intake_advice_type === "none" ? "" : (initial?.intake_advice_type ?? ""))
  );
}

// ----------------------------------------------------------------------------
// Editing the slots
// ----------------------------------------------------------------------------

/**
 * One slot's time or amount changed. A time leaves `amounts` untouched: a course
 * that dosed its base amount on every slot keeps doing so instead of gaining
 * overrides nobody asked for. An amount materializes the whole array, aligned
 * with `times`, so the generator pairs each slot with the amount shown beside it.
 */
export function withSlotChanged(
  schedule: MedSchedule,
  index: number,
  field: "time" | "amount",
  value: string | number,
  base: number,
): MedSchedule {
  if (!hasPerSlotAmounts(schedule)) return schedule;
  const times = [...(schedule.times ?? [])];
  if (field === "time") {
    times[index] = value as string;
    return { ...schedule, times };
  }
  const amounts = alignAmounts(times, schedule.amounts, base);
  amounts[index] = toPositiveAmount(value);
  return { ...schedule, times, amounts };
}

/** One more slot, at a time no slot uses yet. */
export function withSlotAdded(schedule: MedSchedule, base: number): MedSchedule {
  if (!hasPerSlotAmounts(schedule)) return schedule;
  const prevTimes = schedule.times ?? [];
  const times = [...prevTimes, nextUnusedTime(prevTimes)];
  if (!schedule.amounts?.length) return { ...schedule, times };
  // Align the existing slots first: appending to a partial array would shift
  // every uncovered slot onto the amount beside it.
  const amounts = [
    ...alignAmounts(prevTimes, schedule.amounts, base),
    toPositiveAmount(schedule.amounts[0], base),
  ];
  return { ...schedule, times, amounts };
}

/** One slot fewer; the last one is never removed, only reset. */
export function withSlotRemoved(schedule: MedSchedule, index: number, base: number): MedSchedule {
  if (!hasPerSlotAmounts(schedule)) return schedule;
  const filtered = (schedule.times ?? []).filter((_, i) => i !== index);
  const times = filtered.length ? filtered : ["09:00"];
  if (!schedule.amounts?.length) return { ...schedule, times };
  const amounts = schedule.amounts.filter((_, i) => i !== index);
  return { ...schedule, times, amounts: amounts.length ? amounts : [base] };
}

/** A weekday (0 is Sunday) switched on or off. */
export function withDayToggled(schedule: MedSchedule, day: number): MedSchedule {
  if (schedule.mode !== "days_of_week") return schedule;
  const days = (schedule.days_of_week ?? []).includes(day)
    ? (schedule.days_of_week ?? []).filter((x) => x !== day)
    : [...(schedule.days_of_week ?? []), day].sort((a, b) => a - b);
  return { ...schedule, days_of_week: days };
}

/**
 * The schedule after a change of frequency. Staying on a mode keeps what it had;
 * coming back to a weekly schedule restores the last one the form held, so
 * trying another frequency and returning does not replace a real plan with
 * defaults.
 */
export function scheduleForMode(
  mode: Exclude<MedSchedule["mode"], "one_off">,
  current: MedSchedule,
  lastWeekly: MedScheduleDaysOfWeek | null,
): MedSchedule {
  if (mode === "daily_times") return { mode: "daily_times", times: ["09:00"], amounts: [1] };
  if (mode === "interval_hours") {
    const same = current.mode === "interval_hours" ? current : null;
    return {
      mode: "interval_hours",
      interval: { every: same?.interval?.every ?? 1 },
      amount: same ? toPositiveAmount(same.amount) : 1,
    };
  }
  if (mode === "interval_days") {
    const prev = current.mode === "interval_days" ? current : null;
    return {
      mode: "interval_days",
      interval: { every: prev?.interval?.every ?? 1 },
      times: prev?.times?.length ? prev.times : ["09:00"],
      amounts: prev?.amounts?.length ? prev.amounts : [1],
    };
  }
  const prev = current.mode === "days_of_week" ? current : lastWeekly;
  return {
    mode: "days_of_week",
    days_of_week: prev?.days_of_week ?? [1, 2, 3, 4, 5],
    times: prev?.times?.length ? prev.times : ["09:00"],
    ...(prev?.amounts?.length ? { amounts: prev.amounts } : {}),
  };
}

/** Every N hours or days changed; the rest of the schedule stays. */
export function withIntervalEvery(schedule: MedSchedule, every: number): MedSchedule {
  if (schedule.mode === "interval_hours")
    return { ...schedule, interval: { every }, amount: schedule.amount ?? 1 };
  if (schedule.mode === "interval_days")
    return {
      ...schedule,
      interval: { every },
      times: schedule.times ?? ["09:00"],
      amounts: schedule.amounts ?? [1],
    };
  return schedule;
}

/** Each slot with the amount the generator doses there. */
export function reminderSlots(
  schedule: MedSchedule,
  base: number,
): { time: string; amount: number }[] {
  if (!hasPerSlotAmounts(schedule)) return [];
  return (schedule.times ?? []).map((time, i) => ({
    time,
    // No per-slot amount means the generator doses the base amount here, so show that.
    amount: schedule.amounts?.[i] ?? base,
  }));
}

/**
 * The message key for what is wrong with the slot times, if anything. A blank
 * slot is cast to a timestamp by the generator and fails the whole regimen, and
 * two slots at one time show a dose it never produces — it inserts one event
 * per regimen and scheduled minute.
 */
export function reminderTimesProblem(
  schedule: MedSchedule,
): "" | "medications.reminderTimeRequired" | "medications.duplicateReminderTimes" {
  if (!hasPerSlotAmounts(schedule)) return "";
  const times = schedule.times ?? [];
  if (times.some((time) => !/^\d{1,2}:\d{2}(:\d{2})?$/.test(time.trim()))) {
    return "medications.reminderTimeRequired";
  }
  if (new Set(times).size !== times.length) return "medications.duplicateReminderTimes";
  return "";
}

// ----------------------------------------------------------------------------
// What a save writes
// ----------------------------------------------------------------------------

/** Everything the form holds, as both forms hold it. */
export interface CourseFormValues {
  name: string;
  unit: MedicationUnit;
  strength: { name: string; amount: number | null; unit: string };
  /** "", an `INTAKE_ADVICE_OPTIONS` value, or "__none__". */
  intakeAdvice: string;
  intakeAdviceCustom: string;
  schedule: MedSchedule;
  duration: MedDuration;
  startDate: string;
  inventory: { enabled: boolean; current: string; refillThreshold: string };
  notes: string;
}

/** The two advice columns: "none" when there is none, the text only for custom advice. */
export function intakeAdviceColumns(
  advice: string,
  custom: string,
): { intake_advice_type: string; intake_advice_text: string | null } {
  const value = advice.trim() || null;
  const intake_advice_type =
    !value || value === "__none__" ? "none" : value === "custom" ? "custom" : value;
  return {
    intake_advice_type,
    intake_advice_text: intake_advice_type === "custom" ? custom.trim() || null : null,
  };
}

export function inventoryColumn(
  inventory: CourseFormValues["inventory"],
  unit: MedicationUnit,
): RegimenInventory | null {
  return inventory.enabled
    ? {
        enabled: true,
        current_amount: Number(inventory.current) || 0,
        refill_threshold_amount: inventory.refillThreshold
          ? Number(inventory.refillThreshold)
          : undefined,
        unit,
        auto_decrement_on_taken: true,
      }
    : null;
}

/**
 * The course's base dose. Only taken from the slots when they all carry one: a
 * partial array leaves the uncovered slots on the course's base dose, so
 * overwriting it with the first override would quietly re-dose them.
 */
export function baseDoseOf(schedule: MedSchedule, stored: number): number {
  const amounts = (schedule as { amounts?: number[] }).amounts;
  const slotsCoverBaseDose =
    hasPerSlotAmounts(schedule) &&
    !!amounts?.length &&
    amounts.length >= (schedule.times ?? []).length;
  return schedule.mode === "interval_hours"
    ? toPositiveAmount((schedule as { amount?: number }).amount)
    : slotsCoverBaseDose
      ? toPositiveAmount(amounts![0])
      : stored;
}

/** The duration as stored, with the start date the form shows beside it. */
export function durationWithStart(duration: MedDuration, startDate: string): MedDuration {
  return duration.type === "for_days"
    ? { type: "for_days", days: duration.days ?? 1, start_date: startDate }
    : duration.type === "until_date"
      ? { type: "until_date", end_date: duration.end_date ?? "", start_date: startDate }
      : { type: "endless", start_date: startDate };
}

/**
 * The form edits the first per-unit ingredient and carries everything else, so a
 * save that changes only a reminder time cannot destroy a strength recorded
 * elsewhere (`withFormStrength`).
 */
function doseDefinition(
  values: CourseFormValues,
  initial: MedRegimen | null | undefined,
  amount: number,
): PlannedIntake {
  return withFormStrength(
    initial?.dose_definition,
    { amount, unit: values.unit },
    values.strength,
    values.name,
  );
}

/** What a save writes to a course, whether it creates it or edits it. */
export type CourseColumns = Omit<CreateMedRegimenInput, "person_id" | "status">;

/** The columns a regular course saves, the same whether it is created or edited. */
export function regularCourseColumns(
  values: CourseFormValues,
  initial: MedRegimen | null | undefined,
): CourseColumns {
  const amount = baseDoseOf(
    values.schedule,
    toPositiveAmount(initial?.dose_definition?.intake?.amount),
  );
  return {
    custom_name: values.name.trim(),
    intake_unit: values.unit,
    dose_definition: doseDefinition(values, initial, amount),
    ...intakeAdviceColumns(values.intakeAdvice, values.intakeAdviceCustom),
    schedule: values.schedule,
    duration: durationWithStart(values.duration, values.startDate),
    inventory: inventoryColumn(values.inventory, values.unit),
    notes: values.notes.trim() || null,
  };
}

/** The columns a one-off intake saves as a course of its own. */
export function oneTimeCourseColumns(
  values: Pick<CourseFormValues, "name" | "unit" | "strength" | "notes">,
  initial: MedRegimen | null | undefined,
  amount: number,
  dueAt: string,
): CourseColumns {
  return {
    custom_name: values.name.trim(),
    intake_unit: values.unit,
    dose_definition: withFormStrength(
      initial?.dose_definition,
      { amount: toPositiveAmount(amount), unit: values.unit },
      values.strength,
      values.name,
    ),
    intake_advice_type: "none",
    intake_advice_text: null,
    schedule: { mode: "one_off", due_at: dueAt },
    duration: { type: "endless" },
    inventory: null,
    notes: values.notes.trim() || null,
  };
}

/**
 * A one-off intake under a name that already has a course goes into that course
 * rather than starting a second one with the same name: the one picked, or else
 * the one whose name matches exactly, ignoring case.
 */
export function courseToAddTo(
  name: string,
  picked: string | null,
  courses: MedRegimen[] | undefined,
): string | null {
  if (picked) return picked;
  const lower = name.trim().toLowerCase();
  return courses?.find((r) => r.custom_name.trim().toLowerCase() === lower)?.id ?? null;
}

/** What creating a one-off intake saves: into an existing course, or as a course of its own. */
export function oneTimeSubmission(
  values: Pick<CourseFormValues, "name" | "unit" | "strength" | "notes">,
  personId: string,
  amount: number,
  dueAt: string,
  addToRegimenId: string | null,
): CreateMedRegimenInput | AddOneTimeToExistingPayload {
  if (addToRegimenId) {
    return {
      addToRegimenId,
      scheduled_at: dueAt,
      amount: toPositiveAmount(amount),
      unit: values.unit,
      notes: values.notes.trim() || null,
    };
  }
  return { person_id: personId, ...oneTimeCourseColumns(values, null, amount, dueAt) };
}
