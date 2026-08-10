import { z } from "zod";
import { MEDICATION_UNITS } from "@/types/medication";
import type { MedDuration, MedSchedule, PlannedIntake, RegimenInventory } from "@/types/regimen";

/**
 * Zod mirrors of the medication schedule and duration shapes.
 *
 * `med_regimens.schedule` and `.duration` are jsonb columns whose contracts
 * live in TypeScript only (`src/types/regimen.ts`). Handing the model a
 * free-form object would mean it guesses field names and writes rows the app
 * cannot render, so these reproduce the real unions precisely.
 *
 * The assignability checks at the bottom of this file are the drift guard: if
 * `src/types/regimen.ts` gains or renames a field, `just quality-typecheck`
 * fails here rather than the mismatch reaching production data.
 */

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a 24-hour time as HH:MM");

const positiveAmount = z.number().positive().describe("Amount per intake; halves are allowed.");

export const medScheduleSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("daily_times"),
      times: z.array(timeOfDay).min(1).describe('Times of day, e.g. ["08:00", "20:00"].'),
      amounts: z
        .array(positiveAmount)
        .optional()
        .describe("Per-slot amounts, same length and order as `times`."),
      times_mode: z.enum(["manual", "auto_equal_gaps"]).optional(),
      auto: z
        .object({
          count_per_day: z.number().int().positive(),
          day_start: timeOfDay,
          day_end: timeOfDay,
        })
        .optional(),
    }),
    z.object({
      mode: z.literal("interval_hours"),
      interval: z.object({ every: z.number().positive() }),
      amount: positiveAmount.optional(),
    }),
    z.object({
      mode: z.literal("interval_days"),
      interval: z.object({ every: z.number().int().positive() }),
      times: z.array(timeOfDay).min(1),
      amounts: z.array(positiveAmount).optional(),
    }),
    z.object({
      mode: z.literal("days_of_week"),
      days_of_week: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .describe("Days as 0=Sunday through 6=Saturday."),
      times: z.array(timeOfDay).min(1),
    }),
    z.object({
      mode: z.literal("one_off"),
      due_at: z.string().describe("ISO 8601 timestamp for the single dose."),
    }),
  ])
  .describe("How often the medication is taken.");

export const medDurationSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("endless"), start_date: z.string().optional() }),
    z.object({
      type: z.literal("until_date"),
      end_date: z.string().describe("Last day of the course (YYYY-MM-DD)."),
      start_date: z.string().optional(),
    }),
    z.object({
      type: z.literal("for_days"),
      days: z.number().int().positive(),
      start_date: z.string().optional(),
    }),
  ])
  .describe("How long the course runs.");

export const medicationUnitSchema = z
  .enum(MEDICATION_UNITS as unknown as [string, ...string[]])
  .describe("Unit a single intake is measured in.");

export const plannedIntakeSchema = z.object({
  intake: z.object({ amount: positiveAmount, unit: medicationUnitSchema }),
  active: z
    .array(
      z.object({
        name: z.string(),
        amount: z.number(),
        unit: z.string(),
      }),
    )
    .optional()
    .describe("Active ingredients, if known."),
});

export const regimenInventorySchema = z.object({
  enabled: z.boolean().optional().describe("Whether stock is tracked for this medication."),
  current_amount: z.number().nonnegative().optional(),
  unit: z.string().optional(),
  capacity_amount: z.number().nonnegative().optional().describe("Full pack size."),
  refill_threshold_amount: z
    .number()
    .nonnegative()
    .optional()
    .describe("Remaining amount at which a refill reminder fires."),
  auto_decrement_on_taken: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Drift guards. These are type-level only and compile to nothing.
// If they stop compiling, the zod schemas above have diverged from the
// hand-written types in src/types/regimen.ts -- fix the schema, not the check.
// ---------------------------------------------------------------------------
type ScheduleMatches = z.infer<typeof medScheduleSchema> extends MedSchedule ? true : false;
type DurationMatches = z.infer<typeof medDurationSchema> extends MedDuration ? true : false;
type PlannedIntakeMatches =
  z.infer<typeof plannedIntakeSchema> extends PlannedIntake ? true : false;
type InventoryMatches =
  z.infer<typeof regimenInventorySchema> extends RegimenInventory ? true : false;

const _scheduleMatches: ScheduleMatches = true;
const _durationMatches: DurationMatches = true;
const _plannedIntakeMatches: PlannedIntakeMatches = true;
const _inventoryMatches: InventoryMatches = true;
void _scheduleMatches;
void _durationMatches;
void _plannedIntakeMatches;
void _inventoryMatches;
