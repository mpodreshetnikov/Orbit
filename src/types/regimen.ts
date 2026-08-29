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

export type MedInventoryTransactionType = "decrement" | "refill" | "set_absolute" | "correction";

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
  /**
   * Per-slot amounts, same length and order as `times`.
   *
   * The generator has always read these for this mode
   * (`generate_med_dose_events_for_person_ids.sql`), and rows in the fixture
   * corpus carry them; the type simply never said so, which is why the MCP
   * renderer dropped them.
   */
  amounts?: number[];
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

export type MedDuration = MedDurationEndless | MedDurationUntilDate | MedDurationForDays;

/** Today's date in local time as YYYY-MM-DD for comparison with duration end_date. */
function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type GetEffectiveStatusOptions = { today?: string };

/** `date` shifted by whole days, as YYYY-MM-DD. */
function shiftDate(date: string, days: number): string {
  // Midday, so a DST transition cannot push the arithmetic onto the wrong day.
  const shifted = new Date(date + "T12:00:00");
  shifted.setDate(shifted.getDate() + days);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
}

/**
 * The last day a course still counts as running, for status purposes.
 *
 * This is NOT the last day it doses. A `for_days` course stops generating on
 * `start + days` -- `generate_med_dose_events_for_person_ids` skips any date at
 * or after it -- but the status has always treated that boundary day as still
 * active, and the dashboard is built on that. Keeping the two apart is
 * deliberate: `getCourseWindow` answers "when was this taken", this answers
 * "does it still count as running", and only the first is safe to show.
 */
function statusBoundary(duration: MedDuration): string | null {
  if (duration.type === "until_date" && duration.end_date) {
    return duration.end_date.slice(0, 10);
  }
  if (duration.type === "for_days" && duration.start_date != null && duration.days != null) {
    return shiftDate(duration.start_date.slice(0, 10), duration.days);
  }
  return null;
}

/**
 * The calendar days a course is planned to dose on, inclusive of both ends, as
 * YYYY-MM-DD, or null where the duration does not bound that end.
 *
 * The MCP tools render this so that two courses of the same medication under
 * one name can be told apart. The end is the last day a dose is generated for:
 * a four-day course starting on the 26th doses on the 26th through the 29th,
 * because the generator skips dates on or after `start + days`. Reporting the
 * 30th here would put a one-day error into every answer about when a dose
 * changed, which is exactly the kind of question this window exists to answer.
 */
export function getCourseWindow(duration?: MedDuration | null): {
  start: string | null;
  end: string | null;
} {
  if (!duration) return { start: null, end: null };

  const start = duration.start_date ? duration.start_date.slice(0, 10) : null;

  if (duration.type === "until_date" && duration.end_date) {
    return { start, end: duration.end_date.slice(0, 10) };
  }

  if (duration.type === "for_days" && start != null && duration.days != null) {
    return { start, end: shiftDate(start, duration.days - 1) };
  }

  return { start, end: null };
}

/**
 * Returns the effective display status: "active" regimens with end_date (or for_days end) in the past
 * are treated as "completed" so they don't show as active in the list.
 * @param options.today - YYYY-MM-DD override for "today" (for tests).
 */
export function getEffectiveStatus(
  regimen: { status: MedRegimenStatus; duration?: MedDuration },
  options?: GetEffectiveStatusOptions,
): MedRegimenStatus {
  if (regimen.status !== "active") return regimen.status;
  const duration = regimen.duration;
  if (!duration) return regimen.status;
  const today = options?.today ?? todayDateString();
  const boundary = statusBoundary(duration);
  if (boundary != null && boundary < today) return "completed";
  return regimen.status;
}

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

/** Payload when adding a one-time intake to an existing regimen (instead of creating a new one). */
export interface AddOneTimeToExistingPayload {
  addToRegimenId: string;
  scheduled_at: string;
  amount: number;
  unit: string;
  notes?: string | null;
}

export function isAddOneTimeToExistingPayload(
  data: CreateMedRegimenInput | AddOneTimeToExistingPayload,
): data is AddOneTimeToExistingPayload {
  return (
    "addToRegimenId" in data &&
    typeof (data as AddOneTimeToExistingPayload).addToRegimenId === "string"
  );
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

/**
 * Coerce to a usable intake amount, falling back when the value is missing,
 * zero or negative. Fractional doses (0.5, 1.5) are preserved — use this
 * instead of `Math.max(1, …)`, which silently rounds half-pill doses up to 1.
 */
export function toPositiveAmount(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPlannedIntakeAmount(planned: PlannedIntake | null): number {
  return Number(planned?.intake?.amount ?? 1);
}

export function getPlannedIntakeUnit(planned: PlannedIntake | null): string {
  return planned?.intake?.unit ?? "pill";
}
