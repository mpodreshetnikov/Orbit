import type {
  MedDoseEvent,
  MedDuration,
  MedInventoryTransaction,
  MedRegimen,
  MedSchedule,
  PlannedIntake,
  RegimenInventory,
} from "@/types/regimen";
import type { MedicationUnit } from "@/types/medication";
import type { Database, Json } from "@/types/database";

/**
 * Row mappers for the medication tables.
 *
 * These live here rather than in `src/hooks/use-regimens.ts` because they are
 * pure and runtime-agnostic, and both the browser hooks and the server-side MCP
 * tools need them. Re-implementing `rowToRegimen` for the server would be a
 * quiet way for an agent to report a subtly different medication than the app
 * shows. `use-regimens.ts` re-exports them, so existing imports keep working.
 */

type MedIntakeAdviceType = Database["public"]["Enums"]["med_intake_advice_type"];

const MED_INTAKE_ADVICE_TYPES: readonly MedIntakeAdviceType[] = [
  "before_meal",
  "with_meal",
  "after_meal",
  "before_bed",
  "morning_fasting",
  "custom",
  "none",
];

export function toJsonOrNull(value: unknown): Json | null {
  return value == null ? null : (value as Json);
}

export function toRpcOptionalString(value?: string | null): string | undefined {
  if (value == null) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeIntakeAdviceType(
  value?: string | null,
): MedIntakeAdviceType | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return MED_INTAKE_ADVICE_TYPES.includes(value as MedIntakeAdviceType)
    ? (value as MedIntakeAdviceType)
    : null;
}

export function rowToRegimen(row: Record<string, unknown>): MedRegimen {
  return {
    id: row.id as string,
    person_id: row.person_id as string,
    custom_name: row.custom_name as string,
    status: row.status as MedRegimen["status"],
    intake_unit: row.intake_unit as MedicationUnit,
    dose_definition: (row.dose_definition as PlannedIntake | null) ?? null,
    intake_advice_type: (row.intake_advice_type as string | null) ?? null,
    intake_advice_text: (row.intake_advice_text as string | null) ?? null,
    schedule: row.schedule as MedSchedule,
    duration: row.duration as MedDuration,
    reminder_prefs: (row.reminder_prefs as Record<string, unknown> | null) ?? null,
    inventory: (row.inventory as RegimenInventory | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function rowToDoseEvent(row: Record<string, unknown>): MedDoseEvent {
  return {
    id: row.id as string,
    person_id: row.person_id as string,
    regimen_id: row.regimen_id as string,
    scheduled_at: row.scheduled_at as string,
    actual_at: row.actual_at as string,
    planned_intake: (row.planned_intake as PlannedIntake) ?? {
      intake: { amount: 1, unit: "pill" },
      active: [],
    },
    status: row.status as MedDoseEvent["status"],
    taken_at: (row.taken_at as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function rowToInventoryTransaction(row: Record<string, unknown>): MedInventoryTransaction {
  return {
    id: row.id as string,
    regimen_id: row.regimen_id as string,
    event_id: (row.event_id as string | null) ?? null,
    type: row.type as MedInventoryTransaction["type"],
    amount: Number(row.amount ?? 0),
    unit: row.unit as string,
    note: (row.note as string | null) ?? null,
    created_at: row.created_at as string,
  };
}
