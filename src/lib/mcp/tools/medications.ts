import { z } from "zod";
import {
  createRegimen,
  getMedication,
  listMedicationDoses,
  listMedications,
  updateRegimen,
} from "../health/medications";
import { regenerateDoseEvents, resolveTimezone } from "@/lib/medications/regenerate-dose-events";
import { localDayEndUtc, localDayStartUtc } from "../local-day";
import { WRITE_SCOPE } from "./scopes";
import {
  medDurationSchema,
  medScheduleSchema,
  medicationUnitSchema,
  plannedIntakeSchema,
  regimenInventorySchema,
} from "../schemas/regimen";
import { isoDateSchema, personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson, withUserClient } from "../tool-context";
import { fail, ok, summarizeList } from "../tool-result";
import type { McpToolServer } from "./types";

/**
 * Runs the regeneration and reports failure as a value rather than throwing.
 *
 * PostgREST gives no way to wrap the regimen write and the event regeneration
 * in one transaction, and the web UI has the same two-step shape (update, then
 * POST /api/medications/regenerate-events). So a regeneration failure leaves a
 * saved regimen whose reminders are stale. Letting the error propagate would
 * surface as a bare tool failure and invite a retry of the *whole* operation,
 * which would look to the user like the change had not been applied.
 *
 * Reporting partial success instead tells the truth: the medication is saved,
 * the reminders are not, and re-running is safe because regeneration is
 * idempotent (it clears the future window before regenerating).
 */
async function regenerateOrExplain(
  supabase: Parameters<typeof regenerateDoseEvents>[0],
  params: Parameters<typeof regenerateDoseEvents>[1],
): Promise<
  | { ok: true; result: Awaited<ReturnType<typeof regenerateDoseEvents>> }
  | { ok: false; error: string }
> {
  try {
    return { ok: true, result: await regenerateDoseEvents(supabase, params) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

const INTAKE_ADVICE_TYPES = [
  "before_meal",
  "with_meal",
  "after_meal",
  "before_bed",
  "morning_fasting",
  "custom",
  "none",
] as const;

/**
 * Medications, modelled as regimens (what to take, how much, how often) with
 * generated dose events (the individual intakes).
 *
 * Any write that changes the plan must regenerate the upcoming dose events, or
 * "Today's intakes" in the app silently keeps showing the old schedule. That is
 * the same sequence the web UI runs, shared via
 * `@/lib/medications/regenerate-dose-events`.
 */
export function registerMedicationTools(server: McpToolServer): void {
  server.registerTool(
    "list_medications",
    {
      title: "List medications",
      description:
        "List a person's medication regimens with dose, schedule, duration and stock. `effective_status` accounts for courses whose end date has passed, so prefer it over the raw status.",
      inputSchema: z.object({
        ...personSelectorSchema,
        status: z.enum(["active", "paused", "completed", "archived"]).optional(),
        search: z.string().optional().describe("Filter by medication name."),
        include_archived: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const regimens = await listMedications(supabase, {
        personId: person.id,
        status: args.status,
        search: args.search,
        includeArchived: args.include_archived,
      });

      return ok(
        summarizeList(
          `medications for ${person.name}`,
          regimens.map(
            (regimen) =>
              `${regimen.custom_name} — ${regimen.effective_status}` +
              `${regimen.dose_definition?.intake ? `, ${regimen.dose_definition.intake.amount} ${regimen.dose_definition.intake.unit}` : ""}` +
              `, schedule ${regimen.schedule?.mode ?? "unknown"} (id ${regimen.id})`,
          ),
          regimens.length,
        ),
        { person, medications: regimens },
      );
    }),
  );

  server.registerTool(
    "get_medication",
    {
      title: "Get medication",
      description:
        "Get one medication regimen in detail, with its upcoming and recent doses and its inventory movements.",
      inputSchema: z.object({
        regimen_id: uuidSchema,
        horizon_days: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(7)
          .describe("How many days either side of now to include doses for."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient<{ regimen_id: string; horizon_days: number }>(async (supabase, args) => {
      const detail = await getMedication(supabase, {
        regimenId: args.regimen_id,
        horizonDays: args.horizon_days,
      });

      if (!detail?.regimen) {
        return fail(`No medication with id ${args.regimen_id}.`);
      }

      return ok(
        `${detail.regimen.custom_name} — ${detail.regimen.effective_status}. ` +
          `${detail.upcomingDoses.length} upcoming dose(s), ${detail.recentDoses.length} in the recent window.`,
        detail as unknown as Record<string, unknown>,
      );
    }),
  );

  server.registerTool(
    "list_medication_doses",
    {
      title: "List medication intakes",
      description:
        "List a person's individual medication intakes in a date range, with whether each was taken, skipped or is still scheduled. Use this for 'what do I take today?'.",
      inputSchema: z.object({
        ...personSelectorSchema,
        from: isoDateSchema.describe("Start of the range (YYYY-MM-DD), in local time."),
        to: isoDateSchema.describe("End of the range, inclusive (YYYY-MM-DD), in local time."),
        status: z
          .enum(["scheduled", "sent", "taken", "skipped", "snoozed", "missed", "cancelled"])
          .optional(),
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone the dates are expressed in, e.g. 'Europe/Berlin'. Defaults to the user's saved preference, or UTC.",
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args, auth) => {
      // The dates name local calendar days. Treating them as UTC would drop an
      // early-morning dose for anyone east of UTC and pull in one from the next
      // local day -- precisely wrong for "what do I take today?".
      const timezone = await resolveTimezone(supabase, {
        authUserId: auth.authUserId,
        requestedTimezone: args.timezone ?? null,
      });

      const doses = await listMedicationDoses(supabase, {
        personId: person.id,
        from: localDayStartUtc(args.from, timezone),
        to: localDayEndUtc(args.to, timezone),
        status: args.status,
      });

      return ok(
        summarizeList(
          `medication intakes for ${person.name} (${args.from} to ${args.to}, ${timezone})`,
          doses.map(
            (dose) =>
              `${dose.scheduled_at.slice(0, 16).replace("T", " ")} — ${dose.medication_name ?? "unknown"}` +
              `${dose.planned_intake?.intake ? `, ${dose.planned_intake.intake.amount} ${dose.planned_intake.intake.unit}` : ""}` +
              ` [${dose.status}]`,
          ),
          doses.length,
        ),
        { person, doses },
      );
    }),
  );

  server.registerTool(
    "add_medication",
    {
      title: "Add medication",
      description:
        "Create a medication regimen for a person and generate its upcoming intakes. Give the dose, the schedule (how often) and the duration (how long). Confirm the details with the user before calling.",
      inputSchema: z.object({
        ...personSelectorSchema,
        custom_name: z.string().min(1).describe("Medication name as the user refers to it."),
        intake_unit: medicationUnitSchema,
        dose_definition: plannedIntakeSchema.describe("Amount and unit taken per intake."),
        schedule: medScheduleSchema,
        duration: medDurationSchema,
        intake_advice_type: z.enum(INTAKE_ADVICE_TYPES).optional(),
        intake_advice_text: z.string().optional(),
        inventory: regimenInventorySchema.optional().describe("Current stock on hand, if tracked."),
        notes: z.string().optional(),
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone for generating intake times, e.g. 'Europe/Berlin'. Defaults to the user's saved preference, or UTC.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withPerson(async (supabase, person, args, auth) => {
      const regimen = await createRegimen(supabase, {
        person_id: person.id,
        custom_name: args.custom_name,
        status: "active",
        intake_unit: args.intake_unit,
        dose_definition: args.dose_definition,
        schedule: args.schedule,
        duration: args.duration,
        intake_advice_type: args.intake_advice_type ?? "none",
        intake_advice_text: args.intake_advice_text ?? null,
        inventory: args.inventory ?? null,
        notes: args.notes ?? null,
      });

      // Without this the app's "Today's intakes" would not show the new
      // medication until something else triggered generation.
      const regenerated = await regenerateOrExplain(supabase, {
        authUserId: auth.authUserId,
        personId: person.id,
        timezone: args.timezone ?? null,
      });

      if (!regenerated.ok) {
        return ok(
          `Added ${regimen.custom_name} for ${person.name}, but generating its upcoming intakes failed: ${regenerated.error}. The medication is saved; ask the user to open the medications page, or retry update_medication, to regenerate reminders.`,
          { person, medication: regimen, dose_events_error: regenerated.error },
        );
      }

      return ok(
        `Added ${regimen.custom_name} for ${person.name} and generated ${regenerated.result.eventsGenerated} upcoming intake(s) (timezone ${regenerated.result.timezone}).`,
        { person, medication: regimen, dose_events: regenerated.result },
      );
    }, WRITE_SCOPE),
  );

  server.registerTool(
    "update_medication",
    {
      title: "Update medication",
      description:
        "Update an existing medication regimen and regenerate its upcoming intakes. Only the fields you pass are changed. Use status='paused' to pause a course or 'archived' to retire it.",
      inputSchema: z.object({
        regimen_id: uuidSchema,
        custom_name: z.string().min(1).optional(),
        status: z.enum(["active", "paused", "completed", "archived"]).optional(),
        intake_unit: medicationUnitSchema.optional(),
        dose_definition: plannedIntakeSchema.optional(),
        schedule: medScheduleSchema.optional(),
        duration: medDurationSchema.optional(),
        intake_advice_type: z.enum(INTAKE_ADVICE_TYPES).optional(),
        intake_advice_text: z.string().nullable().optional(),
        inventory: regimenInventorySchema.nullable().optional(),
        notes: z.string().nullable().optional(),
        timezone: z.string().optional().describe("IANA timezone for regenerating intake times."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withUserClient<Record<string, unknown> & { regimen_id: string; timezone?: string }>(
      async (supabase, args, auth) => {
        const { regimen_id: regimenId, timezone, ...rest } = args;

        // Only send fields the caller actually supplied, so an omitted field
        // never overwrites stored data with null.
        const values: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rest)) {
          if (value !== undefined) values[key] = value;
        }

        if (Object.keys(values).length === 0) {
          return fail("Nothing to update: pass at least one field to change.");
        }

        const regimen = await updateRegimen(supabase, regimenId, values);

        const regenerated = await regenerateOrExplain(supabase, {
          authUserId: auth.authUserId,
          personId: regimen.person_id,
          timezone: timezone ?? null,
        });

        if (!regenerated.ok) {
          return ok(
            `Updated ${regimen.custom_name} (now ${regimen.effective_status}), but regenerating its upcoming intakes failed: ${regenerated.error}. The change is saved and reminders may be stale; retrying this tool will regenerate them.`,
            { medication: regimen, dose_events_error: regenerated.error },
          );
        }

        return ok(
          `Updated ${regimen.custom_name} (now ${regimen.effective_status}) and regenerated ${regenerated.result.eventsGenerated} upcoming intake(s).`,
          { medication: regimen, dose_events: regenerated.result },
        );
      },
      WRITE_SCOPE,
    ),
  );
}
