// ============================================================================
// REGIMEN / DOSE EVENTS / INVENTORY (med_regimens, med_dose_events, med_inventory_transactions)
// ============================================================================

import type { MedicationUnit } from "./medication";

export type MedRegimenStatus = "active" | "paused" | "completed" | "archived";

export type MedDoseEventStatus =
  | "scheduled"
  | "sent"
  | "taken"
  | "skipped"
  | "snoozed"
  | "missed"
  | "cancelled";

export type MedInventoryTransactionType =
  | "decrement"
  | "refill"
  | "set_absolute"
  | "correction";

// Schedule modes (no cyclic, no stacking)
export type MedScheduleMode =
  | "daily_times"
  | "interval_hours"
  | "interval_days"
  | "days_of_week"
  | "one_off";

export type MedScheduleDailyTimes = {
  mode: "daily_times";
  times_mode?: "manual" | "auto_equal_gaps";
  times: string[];
  /** Per-slot amounts (same length as times). If missing, use dose_definition.intake.amount for all. */
  amounts?: number[];
  auto?: { count_per_day: number; day_start: string; day_end: string };
};

export type MedScheduleIntervalHours = {
  mode: "interval_hours";
  interval: { every: number };
  /** Amount per intake (pills/units). Default 1. */
  amount?: number;
};

export type MedScheduleIntervalDays = {
  mode: "interval_days";
  interval: { every: number };
  /** Full schedule: multiple times per day with optional per-slot amounts. */
  times: string[];
  amounts?: number[];
  /** @deprecated Use times[0] when reading legacy data. */
  time_of_day?: string;
};

export type MedScheduleDaysOfWeek = {
  mode: "days_of_week";
  days_of_week: number[];
  times: string[];
};

export type MedScheduleOneOff = {
  mode: "one_off";
  due_at: string;
};

export type MedSchedule =
  | MedScheduleDailyTimes
  | MedScheduleIntervalHours
  | MedScheduleIntervalDays
  | MedScheduleDaysOfWeek
  | MedScheduleOneOff;

export type MedDurationEndless = { type: "endless"; start_date?: string };
export type MedDurationUntilDate = { type: "until_date"; end_date: string; start_date?: string };
export type MedDurationForDays = { type: "for_days"; days: number; start_date?: string };

export type MedDuration =
  | MedDurationEndless
  | MedDurationUntilDate
  | MedDurationForDays;

export type PlannedIntake = {
  intake?: { amount: number; unit: string };
  active?: { name: string; amount: number; unit: string }[];
};

export type RegimenInventory = {
  enabled?: boolean;
  current_amount?: number;
  unit?: string;
  capacity_amount?: number;
  refill_threshold_amount?: number;
  auto_decrement_on_taken?: boolean;
};

// ============================================================================
// med_regimens
// ============================================================================

export interface MedRegimen {
  id: string;
  person_id: string;
  custom_name: string;
  status: MedRegimenStatus;
  intake_unit: MedicationUnit;
  dose_definition: PlannedIntake | null;
  intake_advice_type: string | null;
  intake_advice_text: string | null;
  schedule: MedSchedule;
  duration: MedDuration;
  reminder_prefs: Record<string, unknown> | null;
  inventory: RegimenInventory | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMedRegimenInput {
  person_id: string;
  custom_name: string;
  status?: MedRegimenStatus;
  intake_unit?: MedicationUnit;
  dose_definition?: PlannedIntake | null;
  intake_advice_type?: string | null;
  intake_advice_text?: string | null;
  schedule: MedSchedule;
  duration: MedDuration;
  reminder_prefs?: Record<string, unknown> | null;
  inventory?: RegimenInventory | null;
  notes?: string | null;
}

export interface UpdateMedRegimenInput {
  custom_name?: string;
  status?: MedRegimenStatus;
  intake_unit?: MedicationUnit;
  dose_definition?: PlannedIntake | null;
  intake_advice_type?: string | null;
  intake_advice_text?: string | null;
  schedule?: MedSchedule;
  duration?: MedDuration;
  reminder_prefs?: Record<string, unknown> | null;
  inventory?: RegimenInventory | null;
  notes?: string | null;
}

// ============================================================================
// med_dose_events
// ============================================================================

export interface MedDoseEvent {
  id: string;
  person_id: string;
  regimen_id: string;
  scheduled_at: string;
  actual_at: string;
  planned_intake: PlannedIntake;
  status: MedDoseEventStatus;
  taken_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface MedDoseEventWithRegimen extends MedDoseEvent {
  regimen?: {
    custom_name: string;
    intake_unit: string;
    intake_advice_type?: string | null;
    intake_advice_text?: string | null;
    schedule?: MedSchedule | null;
  } | null;
}

// ============================================================================
// med_inventory_transactions
// ============================================================================

export interface MedInventoryTransaction {
  id: string;
  regimen_id: string;
  event_id: string | null;
  type: MedInventoryTransactionType;
  amount: number;
  unit: string;
  note: string | null;
  created_at: string;
}

// ============================================================================
// Helpers
// ============================================================================

export function getPlannedIntakeAmount(planned: PlannedIntake | null): number {
  return Number(planned?.intake?.amount ?? 1);
}

export function getPlannedIntakeUnit(planned: PlannedIntake | null): string {
  return planned?.intake?.unit ?? "pill";
}
