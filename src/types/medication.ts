// ============================================================================
// MEDICATION TYPES (medications + medication_intakes)
// ============================================================================

export type MedicationKind = "one_time" | "regular";

export type MedicationStatus = "active" | "paused" | "completed" | "archived";

export type MedicationUnit =
  | "pill"
  | "ml"
  | "drops"
  | "inhalation"
  | "patch"
  | "other"
  | "iu"
  | "ampoule"
  | "capsule"
  | "application"
  | "gram"
  | "injection"
  | "milligram"
  | "spray"
  | "portion"
  | "tablespoon"
  | "teaspoon"
  | "unit"
  | "suppository";

export const MEDICATION_UNITS: MedicationUnit[] = [
  "pill",
  "capsule",
  "ml",
  "drops",
  "milligram",
  "gram",
  "iu",
  "ampoule",
  "injection",
  "inhalation",
  "patch",
  "application",
  "spray",
  "portion",
  "tablespoon",
  "teaspoon",
  "unit",
  "suppository",
  "other",
];

/** Translation key for unit label (e.g. "medications.unitPill"). Use with t(key). */
export function medicationUnitKey(unit: MedicationUnit): string {
  const cap = unit.charAt(0).toUpperCase() + unit.slice(1);
  return `medications.unit${cap}`;
}

/** Format amount with unit for display: "1 ml", "2 pills". */
export function formatMedicationAmount(amount: number, unitLabel: string): string {
  return `${amount} ${unitLabel}`;
}

export const MEDICATION_STATUSES: MedicationStatus[] = [
  "active",
  "paused",
  "completed",
  "archived",
];

export type IntakeAdvice =
  | "before_meal"
  | "with_meal"
  | "after_meal"
  | "before_bed"
  | "morning_fasting"
  | "custom";

export const INTAKE_ADVICE_OPTIONS: IntakeAdvice[] = [
  "before_meal",
  "with_meal",
  "after_meal",
  "before_bed",
  "morning_fasting",
  "custom",
];

// Schedule (regular medications): frequency + duration + reminders
export type MedicationScheduleFrequencyDaily = {
  type: "daily";
};

export type MedicationScheduleFrequencyInterval = {
  type: "interval";
  every: number;
  unit: "hour" | "day";
};

export type MedicationScheduleFrequencyDaysOfWeek = {
  type: "days_of_week";
  days: number[]; // 0=Sun … 6=Sat
};

export type MedicationScheduleFrequency =
  | MedicationScheduleFrequencyDaily
  | MedicationScheduleFrequencyInterval
  | MedicationScheduleFrequencyDaysOfWeek;

export type MedicationScheduleDuration = {
  start_date: string; // ISO date
  end_type: "endless" | "end_date" | "days_from_start";
  end_date?: string; // ISO date
  days_count?: number;
};

export type MedicationReminderSlot = {
  time: string; // HH:mm
  amount: number;
};

export type MedicationSchedule = {
  frequency: MedicationScheduleFrequency;
  duration: MedicationScheduleDuration;
  reminder_times: MedicationReminderSlot[];
};

export function isMedicationScheduleDaily(
  f: MedicationScheduleFrequency,
): f is MedicationScheduleFrequencyDaily {
  return f.type === "daily";
}

export function isMedicationScheduleInterval(
  f: MedicationScheduleFrequency,
): f is MedicationScheduleFrequencyInterval {
  return f.type === "interval";
}

export function isMedicationScheduleDaysOfWeek(
  f: MedicationScheduleFrequency,
): f is MedicationScheduleFrequencyDaysOfWeek {
  return f.type === "days_of_week";
}

/** Amount for a given time (HH:mm) from reminder_times; for one-time uses one_time_amount. */
export function getMedicationAmountForTime(med: Medication, time: string): number {
  if (med.kind === "one_time") return med.one_time_amount ?? 1;
  if (!med.schedule?.reminder_times?.length) return 1;
  const slot = med.schedule.reminder_times.find((s) => s.time === time);
  return slot != null && slot.amount != null ? Number(slot.amount) : 1;
}

// ============================================================================
// medications table
// ============================================================================

export interface Medication {
  id: string;
  person_id: string;
  name: string;
  kind: MedicationKind;
  unit: MedicationUnit;
  dose_per_unit: string | null;
  intake_advice: string | null;
  intake_advice_custom: string | null;
  scheduled_at: string | null;
  one_time_amount: number | null;
  schedule: MedicationSchedule | null;
  inventory_enabled: boolean;
  inventory_current: number | null;
  inventory_refill_threshold: number | null;
  status: MedicationStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMedicationInput {
  person_id: string;
  name: string;
  kind: MedicationKind;
  unit: MedicationUnit;
  dose_per_unit?: string | null;
  intake_advice?: string | null;
  intake_advice_custom?: string | null;
  scheduled_at?: string | null;
  one_time_amount?: number | null;
  schedule?: MedicationSchedule | null;
  inventory_enabled?: boolean;
  inventory_current?: number | null;
  inventory_refill_threshold?: number | null;
  status?: MedicationStatus;
  notes?: string | null;
}

export interface UpdateMedicationInput {
  name?: string;
  kind?: MedicationKind;
  unit?: MedicationUnit;
  dose_per_unit?: string | null;
  intake_advice?: string | null;
  intake_advice_custom?: string | null;
  scheduled_at?: string | null;
  one_time_amount?: number | null;
  schedule?: MedicationSchedule | null;
  inventory_enabled?: boolean;
  inventory_current?: number | null;
  inventory_refill_threshold?: number | null;
  status?: MedicationStatus;
  notes?: string | null;
}

// ============================================================================
// medication_intakes table
// ============================================================================

export interface MedicationIntake {
  id: string;
  medication_id: string;
  taken_at: string;
  amount: number;
  skipped: boolean;
  note: string | null;
  created_at: string;
}

export interface CreateMedicationIntakeInput {
  medication_id: string;
  taken_at?: string; // ISO, default now
  amount?: number;
  skipped?: boolean;
  note?: string | null;
}

export interface UpdateMedicationIntakeInput {
  taken_at?: string;
  amount?: number;
  skipped?: boolean;
  note?: string | null;
}

// ============================================================================
// Filters for list
// ============================================================================

export interface MedicationsFilters {
  kind?: MedicationKind | null;
  status?: MedicationStatus | null;
}
