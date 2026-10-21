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

/**
 * A calendar day that exists, as YYYY-MM-DD. The pattern alone would let
 * `2026-02-30` through, and the generator's `::date` cast then fails the whole
 * regeneration after the regimen has already been saved.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar date as YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Not a calendar date");

/**
 * The slot checks every schedule with `times` shares. Only one event can exist
 * per regimen and minute, so a repeated time is a slot the generator silently
 * drops; and an `amounts` entry with no time to pair with is an amount nothing
 * ever doses. Both are refused here, on write, because the stored row cannot
 * say afterwards which slot the caller meant. Each check reads only the object
 * being written, so a call that repairs a bad stored row is accepted -- it
 * carries the corrected schedule, never the stored one.
 */
function checkSlots(
  value: { times: string[]; amounts?: number[] },
  ctx: { addIssue: (issue: { code: "custom"; message: string; path: PropertyKey[] }) => void },
): void {
  const seen = new Set<string>();
  value.times.forEach((time, index) => {
    if (seen.has(time)) {
      ctx.addIssue({
        code: "custom",
        message: `${time} appears more than once; each time of day is one slot`,
        path: ["times", index],
      });
    }
    seen.add(time);
  });
  if (value.amounts && value.amounts.length > value.times.length) {
    ctx.addIssue({
      code: "custom",
      message: `${value.amounts.length} amounts for ${value.times.length} times; give at most one amount per time`,
      path: ["amounts"],
    });
  }
}

export const medScheduleSchema = z
  .discriminatedUnion("mode", [
    z
      .object({
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
      })
      .superRefine(checkSlots),
    z.object({
      mode: z.literal("interval_hours"),
      // A whole number, as for `interval_days`: the generator casts `every` from
      // text to `int`, so `1.5` fails regeneration after the row is saved.
      interval: z.object({ every: z.number().int().positive() }),
      amount: positiveAmount.optional(),
    }),
    z
      .object({
        mode: z.literal("interval_days"),
        interval: z.object({ every: z.number().int().positive() }),
        times: z.array(timeOfDay).min(1),
        amounts: z.array(positiveAmount).optional(),
      })
      .superRefine(checkSlots),
    z
      .object({
        mode: z.literal("days_of_week"),
        days_of_week: z
          .array(z.number().int().min(0).max(6))
          .min(1)
          .describe("Days as 0=Sunday through 6=Saturday."),
        times: z.array(timeOfDay).min(1),
        amounts: z
          .array(positiveAmount)
          .optional()
          .describe("Per-slot amounts, same length and order as `times`."),
      })
      .superRefine(checkSlots),
    z.object({
      mode: z.literal("one_off"),
      // An instant, with its offset: a bare local time names a different
      // moment in every timezone, and the reply would quote it as if it did not.
      due_at: z
        .string()
        .datetime({ offset: true, message: "Expected an ISO 8601 timestamp with an offset or Z" })
        .describe("ISO 8601 timestamp for the single dose, with its offset or Z."),
    }),
  ])
  .describe("How often the medication is taken.");

export const medDurationSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("endless"), start_date: calendarDate.optional() }),
    z
      .object({
        type: z.literal("until_date"),
        end_date: calendarDate.describe("Last day of the course (YYYY-MM-DD)."),
        start_date: calendarDate.optional(),
      })
      // The generator answers an end before the start by producing no events
      // at all, so the course would be saved and never dose.
      .refine((value) => value.start_date == null || value.end_date >= value.start_date, {
        message: "end_date is before start_date",
        path: ["end_date"],
      }),
    z.object({
      type: z.literal("for_days"),
      days: z.number().int().positive(),
      start_date: calendarDate.optional(),
    }),
  ])
  .describe("How long the course runs.");

export const medicationUnitSchema = z
  .enum(MEDICATION_UNITS as unknown as [string, ...string[]])
  .describe("Unit a single intake is measured in.");

export const plannedIntakeSchema = z.object({
  intake: z.object({ amount: positiveAmount, unit: medicationUnitSchema }),
  unit_strength: z
    .array(
      z.object({
        name: z.string(),
        amount: positiveAmount,
        unit: z.string(),
      }),
    )
    .optional()
    .describe(
      "What ONE unit of the dosage form contains -- 100 milligram in one tablet, not what the whole intake delivers. Stays the same when the amount changes, so it survives a titration; the per-intake total is derived from it. Omit only where the form is the ingredient itself, such as a powder dosed in milligrams.",
    ),
  active: z
    .array(
      z.object({
        name: z.string(),
        amount: z.number(),
        unit: z.string(),
      }),
    )
    .optional()
    .describe(
      "Legacy: the ingredients the whole intake delivers. Nothing rescales this when an amount changes, so a reader cannot tell which amount it was recorded for. Prefer `unit_strength` for anything new.",
    ),
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
  auto_decrement_on_taken: z
    .boolean()
    .optional()
    .describe(
      "Whether taking a dose reduces the stock figure. Defaults to true where tracking is enabled; pass false to keep the number by hand.",
    ),
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
