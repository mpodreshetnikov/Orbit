import type { Database } from "@db";
import type { MedSchedule } from "@orbit-types/regimen";
import { asUnit, formatAmountWithUnit } from "@/features/medications/format";

export type DoseStatus = Database["public"]["Enums"]["med_dose_event_status"];

/** The columns a day's list selects. Narrower than the row on purpose: what the screens can see is
 * what the query asks for, so neither can quietly start depending on something the other lacks. */
export type DayDose = {
  id: string;
  regimen_id: string;
  actual_at: string;
  taken_at: string | null;
  status: DoseStatus;
  planned_intake: unknown;
  regimen: {
    custom_name: string;
    intake_unit: string;
    intake_advice_type: string | null;
    intake_advice_text: string | null;
    schedule: unknown;
  } | null;
};

/** The statuses a list holds. `cancelled` is neither a thing to do nor a thing done. The web app's
 * `fetchDoseEventsForPerson` and `fetchDoseEventsForRegimen` list the same six. */
export const LISTED_STATUSES = [
  "scheduled",
  "sent",
  "snoozed",
  "taken",
  "skipped",
  "missed",
] as const;

const OPEN: ReadonlySet<DoseStatus> = new Set(["scheduled", "sent", "snoozed"]);

/** Still to be taken: planned, reminded, or put off. */
export function isOpen(status: DoseStatus): boolean {
  return OPEN.has(status);
}

/**
 * The planned amount for one intake, as `planned_intake.intake.amount` holds it.
 *
 * Deliberately never derived from `unit_strength`: `ADR-260907-cvj` records that strength is per
 * unit and a per-intake total is stored nowhere, so a client that multiplied them would be inventing
 * a number the rest of the product refuses to keep. A missing or unusable amount reads as one, as the
 * web app's `getPlannedIntakeAmount` reads it.
 */
export function plannedAmount(plannedIntake: unknown): number {
  const intake = (plannedIntake as { intake?: { amount?: unknown } } | null)?.intake;
  const amount = intake?.amount;
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : 1;
}

function plannedUnit(dose: DayDose): string | null {
  const intake = (dose.planned_intake as { intake?: { unit?: unknown } } | null)?.intake;
  return typeof intake?.unit === "string" ? intake.unit : (dose.regimen?.intake_unit ?? null);
}

/** "2 таблетки": the dose's planned amount in its own unit. */
export function doseAmountLabel(dose: DayDose): string {
  return formatAmountWithUnit(plannedAmount(dose.planned_intake), asUnit(plannedUnit(dose)));
}

/** The unit an icon is drawn for: the course's, falling back to the dose's own. */
export function doseUnit(dose: DayDose) {
  return asUnit(dose.regimen?.intake_unit ?? plannedUnit(dose));
}

/** The medication's name, or an em dash when the join came back empty. */
export function doseName(dose: DayDose): string {
  return dose.regimen?.custom_name ?? "—";
}

/** "09:00" in the phone's own timezone, 24-hour as the web app writes it. */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return "--:--";
  }
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export function isOneOff(dose: DayDose): boolean {
  return (dose.regimen?.schedule as MedSchedule | null)?.mode === "one_off";
}
