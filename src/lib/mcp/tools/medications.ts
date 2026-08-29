import { z } from "zod";
import {
  createRegimen,
  findRegimensByName,
  getMedication,
  listMedicationDoses,
  listMedications,
  logDose,
  updateRegimen,
  type RegimenWithStatus,
} from "../health/medications";
import {
  readTimezonePreference,
  regenerateDoseEvents,
} from "@/lib/medications/regenerate-dose-events";
import { isValidTimeZone, localDayEndUtc, localDayStartUtc } from "../local-day";
import { formatZoned, instantFromInput, withZonedTimestamps } from "../zoned-time";
import { WRITE_SCOPE } from "./scopes";
import {
  medDurationSchema,
  medScheduleSchema,
  medicationUnitSchema,
  plannedIntakeSchema,
  regimenInventorySchema,
} from "../schemas/regimen";
import {
  isoDateSchema,
  paginationSchema,
  personSelectorSchema,
  uuidSchema,
} from "../schemas/common";
import { withPerson, withUserClient } from "../tool-context";
import { fail, ok, paginate, summarizePage } from "../tool-result";
import { getCourseWindow } from "@/types/regimen";
import type { MedDuration, MedSchedule, PlannedIntake } from "@/types/regimen";
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

/**
 * One-line rendering of a regimen, shared by the listing and by the duplicate
 * guard, so the candidates the guard offers look exactly like the ones
 * `list_medications` returned.
 */
/**
 * One intake, with what it actually delivers: "1.5 pill (Сертралин 150 milligram)".
 *
 * The active ingredients are the answer to "how many milligrams", and they were
 * stored on the regimen and copied onto every dose event long before any tool
 * rendered them. Printing only "1.5 pill" is what made an assistant tell the
 * owner the record held no milligrams and offer a fork between 50 mg and 100 mg
 * tablets, while `dose_definition.active` said 150 mg.
 */
function describeIntake(planned: PlannedIntake | null | undefined): string {
  const intake = planned?.intake;
  const active = planned?.active ?? [];
  const strength =
    active.length > 0
      ? ` (${active.map((one) => `${one.name} ${one.amount} ${one.unit}`).join(" + ")})`
      : "";

  if (!intake) {
    return strength ? `dose unknown${strength}` : "";
  }
  return `${intake.amount} ${intake.unit}${strength}`;
}

/**
 * The calendar days a course covers, from the same computation
 * `getEffectiveStatus` uses. Without it, four courses of one medication under
 * one name render as four interchangeable lines and their order is guesswork.
 */
function describeCourseWindow(duration: MedDuration | null | undefined): string {
  const { start, end } = getCourseWindow(duration);
  if (start && end) return `${start} to ${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return "";
}

/**
 * The plan's own times, which are local wall-clock strings on the regimen
 * rather than instants -- labelled as such, since the same reply quotes real
 * instants converted into a named zone (T-0027).
 */
function describeSchedule(schedule: MedSchedule | null | undefined): string {
  if (!schedule) return "schedule unknown";

  // Every field is read defensively: these are jsonb columns whose shape is a
  // TypeScript promise rather than a database constraint, and a row written
  // before a mode gained a field would otherwise throw here and take the whole
  // reply down -- on a list where the other medications are fine.
  const at = (times?: string[]) =>
    times && times.length > 0 ? ` at ${times.join(", ")} (local wall clock)` : "";

  switch (schedule.mode) {
    case "daily_times":
      return `schedule daily_times${at(schedule.times)}`;
    case "interval_hours":
      return `schedule interval_hours every ${schedule.interval?.every ?? "?"}h`;
    case "interval_days":
      return `schedule interval_days every ${schedule.interval?.every ?? "?"}d${at(schedule.times)}`;
    case "days_of_week":
      return `schedule days_of_week${schedule.days_of_week?.length ? ` on ${schedule.days_of_week.join(", ")}` : ""}${at(schedule.times)}`;
    case "one_off":
      return "schedule one_off";
    default:
      return "schedule unknown";
  }
}

/** Stock on hand, when the course tracks it. */
function describeStock(regimen: RegimenWithStatus): string {
  const inventory = regimen.inventory;
  if (!inventory?.enabled || inventory.current_amount == null) return "";
  return `stock ${inventory.current_amount} ${inventory.unit ?? regimen.intake_unit}`;
}

/** A course note, kept short enough for a list line. `get_medication` prints it whole. */
function describeNotesExcerpt(notes: string | null): string {
  const trimmed = notes?.trim();
  if (!trimmed) return "";
  const oneLine = trimmed.replace(/\s+/g, " ");
  return oneLine.length > 80 ? `note "${oneLine.slice(0, 79)}…"` : `note "${oneLine}"`;
}

function describeRegimen(regimen: RegimenWithStatus): string {
  // Every part the tool's own description promises -- "dose, schedule, duration
  // and stock" -- plus the note, which is where a tablet strength tends to be
  // written down while `active` is empty.
  const parts = [
    describeIntake(regimen.dose_definition),
    describeSchedule(regimen.schedule),
    describeCourseWindow(regimen.duration),
    describeStock(regimen),
    describeNotesExcerpt(regimen.notes),
  ].filter((part) => part.length > 0);

  return `${regimen.custom_name} — ${regimen.effective_status}, ${parts.join(", ")} (id ${regimen.id})`;
}

/**
 * The timestamps on a dose event. Rendered into the reply in the caller's zone
 * and offered beside the stored instants in `structuredContent`.
 */
const DOSE_EVENT_TIMESTAMPS = ["scheduled_at", "actual_at", "taken_at"] as const;

/** How many intakes either side of now `get_medication` spells out in its text block. */
const DETAIL_DOSE_LIMIT = 10;

/**
 * Resolves the zone a reply's times are quoted in, without moving anything.
 *
 * `resolveTimezone` *persists* what it is handed into
 * `checkup_notification_timezone`, which drives the generation cron and both
 * reminder digests -- so using it here would let a request to see a time re-time
 * the household's plan. An unrecognised zone is refused rather than falling
 * through to UTC, since silently answering in the wrong zone is the defect this
 * whole contract exists to close.
 */
async function resolveDisplayZone(
  supabase: Parameters<typeof readTimezonePreference>[0],
  authUserId: string,
  requested: string | undefined,
): Promise<{ ok: true; timezone: string } | { ok: false; error: string }> {
  const trimmed = requested?.trim() || null;

  if (trimmed && !isValidTimeZone(trimmed)) {
    return {
      ok: false,
      error:
        `"${requested}" is not a timezone this server recognises. Pass an IANA name ` +
        `like "Europe/Berlin".`,
    };
  }

  return {
    ok: true,
    timezone: trimmed ?? (await readTimezonePreference(supabase, authUserId)) ?? "UTC",
  };
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
        "List a person's medication regimens with dose, active ingredients, schedule, course dates, stock and notes. `effective_status` accounts for courses whose end date has passed, so prefer it over the raw status. Courses of the same medication are told apart by their date windows.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...paginationSchema,
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

      // Paged here rather than in the query: `listMedications` filters `search`
      // in memory, so a database-side range would page the unfiltered rows.
      const page = paginate(regimens, args.limit, args.offset);

      return ok(
        summarizePage(`medications for ${person.name}`, page.page.map(describeRegimen), {
          total: regimens.length,
          offset: args.offset,
          has_more: page.has_more,
          next_offset: page.next_offset,
        }),
        {
          person,
          medications: page.page,
          total: regimens.length,
          limit: args.limit,
          offset: args.offset,
          has_more: page.has_more,
          next_offset: page.next_offset,
        },
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
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone the dose times are reported in, e.g. 'Europe/Berlin'. Defaults to the user's saved preference, or UTC.",
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient<{ regimen_id: string; horizon_days: number; timezone?: string }>(
      async (supabase, args, auth) => {
        // The regimen's `schedule.times` are local wall-clock strings and its
        // dose events are UTC instants. Returning both without saying so is
        // what let an assistant read a 22:00 course as a 15:00 one (T-0027), so
        // the doses are quoted in a named zone here rather than raw.
        const zone = await resolveDisplayZone(supabase, auth.authUserId, args.timezone);
        if (!zone.ok) {
          return fail(zone.error);
        }

        const detail = await getMedication(supabase, {
          regimenId: args.regimen_id,
          horizonDays: args.horizon_days,
        });

        if (!detail?.regimen) {
          return fail(`No medication with id ${args.regimen_id}.`);
        }

        const inZone = (doses: typeof detail.upcomingDoses) =>
          doses.map((dose) =>
            withZonedTimestamps(
              dose as unknown as Record<string, unknown>,
              zone.timezone,
              DOSE_EVENT_TIMESTAMPS,
            ),
          );

        const next = detail.upcomingDoses[0];
        const previous = detail.recentDoses[detail.recentDoses.length - 1];

        // The description promises detail, and what this returned was one line
        // counting the doses -- strictly less than `list_medications` prints
        // for the same course. So the summary keeps the counts and the T-0027
        // zone contract, then actually says what the course is and lists the
        // doses and stock movements it is counting.
        const plan = [
          describeIntake(detail.regimen.dose_definition),
          describeSchedule(detail.regimen.schedule),
          describeCourseWindow(detail.regimen.duration),
          describeStock(detail.regimen),
        ].filter((part) => part.length > 0);

        const notes = detail.regimen.notes?.trim();
        // A 30-day horizon on a twice-daily course is 120 intakes. List the
        // ones nearest now and say how many were left out, rather than either
        // dumping all of them or going back to a bare count.
        const listed = <T>(rows: T[], keep: "first" | "last") => {
          if (rows.length <= DETAIL_DOSE_LIMIT) return { rows, omitted: 0 };
          return {
            rows:
              keep === "first" ? rows.slice(0, DETAIL_DOSE_LIMIT) : rows.slice(-DETAIL_DOSE_LIMIT),
            omitted: rows.length - DETAIL_DOSE_LIMIT,
          };
        };
        const recent = listed(detail.recentDoses, "last");
        const upcoming = listed(detail.upcomingDoses, "first");
        const more = (omitted: number) => (omitted > 0 ? `\n- ...${omitted} more` : "");
        const doseLine = (dose: (typeof detail.upcomingDoses)[number]) =>
          `- ${formatZoned(dose.scheduled_at, zone.timezone)} — ${describeIntake(dose.planned_intake) || "dose unknown"} [${dose.status}]` +
          `${dose.taken_at ? `, taken ${formatZoned(dose.taken_at, zone.timezone)}` : ""}` +
          `${dose.note?.trim() ? `, note "${dose.note.trim()}"` : ""}`;
        const movementLine = (movement: (typeof detail.inventoryTransactions)[number]) =>
          `- ${formatZoned(movement.created_at, zone.timezone)} — ${movement.type} ${movement.amount} ${movement.unit}` +
          `${movement.note?.trim() ? `, note "${movement.note.trim()}"` : ""}`;

        return ok(
          `${detail.regimen.custom_name} — ${detail.regimen.effective_status}. ` +
            `${detail.upcomingDoses.length} upcoming dose(s), ${detail.recentDoses.length} in the recent window. ` +
            `Times are ${zone.timezone}` +
            `${next ? `; next ${formatZoned(next.scheduled_at, zone.timezone)}` : ""}` +
            `${previous ? `; last ${formatZoned(previous.taken_at ?? previous.scheduled_at, zone.timezone)}` : ""}.` +
            `\n${plan.join(", ")}.` +
            `${notes ? `\nNotes: ${notes}` : ""}` +
            `${recent.rows.length > 0 ? `\nRecent intakes:${more(recent.omitted)}\n${recent.rows.map(doseLine).join("\n")}` : ""}` +
            `${upcoming.rows.length > 0 ? `\nUpcoming intakes:\n${upcoming.rows.map(doseLine).join("\n")}${more(upcoming.omitted)}` : ""}` +
            `${detail.inventoryTransactions.length > 0 ? `\nInventory movements:\n${detail.inventoryTransactions.map(movementLine).join("\n")}` : ""}`,
          {
            ...detail,
            timezone: zone.timezone,
            upcomingDoses: inZone(detail.upcomingDoses),
            recentDoses: inZone(detail.recentDoses),
            inventoryTransactions: detail.inventoryTransactions.map((transaction) =>
              withZonedTimestamps(
                transaction as unknown as Record<string, unknown>,
                zone.timezone,
                ["created_at"],
              ),
            ),
          } as unknown as Record<string, unknown>,
        );
      },
    ),
  );

  server.registerTool(
    "list_medication_doses",
    {
      title: "List medication intakes",
      description:
        "List a person's individual medication intakes in a date range, with the amount and active ingredients of each, whether it was taken, skipped or is still scheduled, and any note. Use this for 'what do I take today?', and pass `regimen_id` to follow one course's dose over time.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...paginationSchema,
        from: isoDateSchema.describe("Start of the range (YYYY-MM-DD), in local time."),
        to: isoDateSchema.describe("End of the range, inclusive (YYYY-MM-DD), in local time."),
        regimen_id: uuidSchema
          .optional()
          .describe("Only intakes of this medication. Get the id from list_medications."),
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
      //
      // Read the preference rather than resolving it: this tool is declared
      // read-only, and `resolveTimezone` would persist the hint into
      // `checkup_notification_timezone`, re-timing the household's generated
      // events and reminders. Asking what is due today must not move anything.
      const zone = await resolveDisplayZone(supabase, auth.authUserId, args.timezone);
      if (!zone.ok) {
        return fail(zone.error);
      }
      const timezone = zone.timezone;

      const doses = await listMedicationDoses(supabase, {
        personId: person.id,
        from: localDayStartUtc(args.from, timezone),
        to: localDayEndUtc(args.to, timezone),
        status: args.status,
        regimenId: args.regimen_id,
      });

      const page = paginate(doses, args.limit, args.offset);

      return ok(
        summarizePage(
          `medication intakes for ${person.name} (${args.from} to ${args.to}, ${timezone})`,
          page.page.map(
            // Rendered in the zone the range was resolved in. Printing
            // `scheduled_at.slice(0, 16)` put the UTC instant under a header
            // naming the local zone, which is how a 22:00 dose came to be
            // reported as a 15:00 one (T-0027).
            //
            // The amount carries its active ingredients and the row carries its
            // note, both of which this line used to drop -- so an assistant
            // reading it could not say how many milligrams an intake was, nor
            // tell "no note" apart from "notes are not returned".
            (dose) =>
              `${formatZoned(dose.scheduled_at, timezone)} — ${dose.medication_name ?? "unknown"}` +
              `${describeIntake(dose.planned_intake) ? `, ${describeIntake(dose.planned_intake)}` : ""}` +
              ` [${dose.status}]` +
              `${dose.note?.trim() ? `, note "${dose.note.trim()}"` : ""}`,
          ),
          {
            total: doses.length,
            offset: args.offset,
            has_more: page.has_more,
            next_offset: page.next_offset,
          },
        ),
        {
          person,
          timezone,
          doses: page.page.map((dose) =>
            withZonedTimestamps(
              dose as unknown as Record<string, unknown>,
              timezone,
              DOSE_EVENT_TIMESTAMPS,
            ),
          ),
          total: doses.length,
          limit: args.limit,
          offset: args.offset,
          has_more: page.has_more,
          next_offset: page.next_offset,
        },
      );
    }),
  );

  server.registerTool(
    "add_medication",
    {
      title: "Add medication",
      description:
        "Create a NEW medication regimen for a person and generate its upcoming intakes. Give the dose, the schedule (how often) and the duration (how long). This is not the tool for a single intake of something the person already takes — use log_dose for that. Confirm the details with the user before calling.",
      inputSchema: z.object({
        ...personSelectorSchema,
        custom_name: z.string().min(1).describe("Medication name as the user refers to it."),
        allow_duplicate: z
          .boolean()
          .default(false)
          .describe(
            "Create this even though the person already has a medication of the same name still running. Pass true for a genuinely separate concurrent course, or a different medication that shares the name. A course that has already finished does not block creation.",
          ),
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
      // Without this a request like "she took half an Atarax tonight" becomes a
      // second medication standing beside the real course, because creating one
      // was the only write this server offered. Refusing costs one round-trip
      // and turns a silent duplicate into a choice the caller has to make: log
      // the intake, change the existing course, or say this really is a
      // different medication.
      const existing = await findRegimensByName(supabase, {
        personId: person.id,
        name: args.custom_name,
      });

      // Only a course that is still running can be the one the caller meant.
      // A completed or archived course under the same name is the ordinary
      // shape of a re-prescription -- titration is recorded as successive
      // courses, and Atarax in 2025 does not mean Atarax in 2026 is a mistake.
      // Blocking that had no right answer: logging today's intake against last
      // year's course is wrong, and `update_medication` would overwrite the
      // record of what the earlier course actually was.
      const live = existing.filter(
        (regimen) => regimen.effective_status === "active" || regimen.effective_status === "paused",
      );

      if (live.length > 0 && !args.allow_duplicate) {
        const ended = existing.filter((regimen) => !live.includes(regimen));
        return fail(
          `${person.name} already has ${live.length} medication(s) named "${args.custom_name.trim()}" still running, so nothing was created:\n` +
            live.map((regimen) => `- ${describeRegimen(regimen)}`).join("\n") +
            (ended.length > 0
              ? `\nAlso on record, already finished:\n` +
                ended.map((regimen) => `- ${describeRegimen(regimen)}`).join("\n")
              : "") +
            `\nTo record a single intake of it, call log_dose with one of the running regimen_id values. ` +
            `To change the dose, extend or pause that course, call update_medication. ` +
            `Pass allow_duplicate: true if this is genuinely a second concurrent course, or a ` +
            `different medication that happens to share the name.`,
          { person, existing_medications: existing },
        );
      }

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

      // Named even on the way out, so a caller that overrode the guard can still
      // see what it now sits beside and offer to archive the old course.
      const alongside =
        existing.length > 0
          ? ` It now stands beside ${existing.length} other medication(s) with the same name: ` +
            `${existing.map((regimen) => regimen.id).join(", ")}.`
          : "";

      if (!regenerated.ok) {
        return ok(
          `Added ${regimen.custom_name} for ${person.name}, but generating its upcoming intakes failed: ${regenerated.error}. The medication is saved; ask the user to open the medications page, or retry update_medication, to regenerate reminders.${alongside}`,
          {
            person,
            medication: regimen,
            dose_events_error: regenerated.error,
            existing_medications: existing,
          },
        );
      }

      return ok(
        `Added ${regimen.custom_name} for ${person.name} and generated ${regenerated.result.eventsGenerated} upcoming intake(s) (timezone ${regenerated.result.timezone}).${alongside}`,
        {
          person,
          medication: regimen,
          dose_events: regenerated.result,
          existing_medications: existing,
        },
      );
    }, WRITE_SCOPE),
  );

  server.registerTool(
    "log_dose",
    {
      title: "Log a medication intake",
      description:
        "Record that a dose of a medication the person already has was taken, or skipped. Covers both a scheduled intake and an unplanned one outside the schedule — a dose already on the plan at that time is resolved rather than duplicated. Use this, not add_medication, whenever a course for that medication already exists; find its regimen_id with list_medications. Taking a dose decrements the stock if the medication tracks one.",
      inputSchema: z.object({
        regimen_id: uuidSchema.describe("The existing medication this intake belongs to."),
        taken_at: z
          .string()
          .optional()
          .describe(
            "When the dose was taken. Either ISO 8601 with an offset ('2026-08-19T23:10:00+07:00') or a local wall-clock time ('2026-08-19T23:10'), which is read in `timezone`. Defaults to now.",
          ),
        amount: z
          .number()
          .positive()
          .optional()
          .describe("Amount taken; halves are allowed. Defaults to the medication's planned dose."),
        status: z.enum(["taken", "skipped"]).default("taken"),
        note: z.string().optional(),
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone an offset-less `taken_at` is expressed in, e.g. 'Europe/Berlin'. Defaults to the user's saved preference, or UTC.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withUserClient<{
      regimen_id: string;
      taken_at?: string;
      amount?: number;
      status: "taken" | "skipped";
      note?: string;
      timezone?: string;
    }>(async (supabase, args, auth) => {
      // A mis-read timestamp files the intake at the wrong instant, and the app
      // would then show it as a dose the person still owes tonight. Two traps
      // are worth refusing over: `new Date` reads an offset-less string in the
      // *server's* zone (UTC in production, so hours off for anyone else), and
      // it happily accepts non-ISO input like "0". So parse deliberately.
      //
      // The zone is resolved whether or not the input needs it, because the
      // confirmation quotes the time back and doing that in UTC is how "I took
      // it at 22:00" came back as "...at 15:00Z" (T-0027). Read the preference,
      // never write it: `resolveTimezone` persists what it is handed into
      // `checkup_notification_timezone`, which the nightly generation cron and
      // both reminder digests run on, so a hint given to interpret one
      // timestamp would re-time every future dose and checkup in the household.
      const zone = await resolveDisplayZone(supabase, auth.authUserId, args.timezone);
      if (!zone.ok) {
        return fail(`${zone.error} Or give taken_at with an explicit offset.`);
      }
      const timezone = zone.timezone;

      const requested = args.taken_at?.trim();
      let at: Date;
      let readAsLocal = false;

      if (!requested) {
        at = new Date();
      } else {
        const parsed = instantFromInput(requested, timezone);
        if (!parsed.ok) {
          return fail(
            parsed.zoneApplied
              ? `Could not read "${args.taken_at}" as a date and time in ${timezone}. Pass ISO 8601 ` +
                  `with an offset ("2026-08-19T23:10:00+07:00"), or a local wall-clock time ` +
                  `("2026-08-19T23:10") that exists in that zone — a clock-change gap has no such ` +
                  `local time.`
              : `Could not read "${args.taken_at}" as a date and time.`,
          );
        }
        at = new Date(parsed.instant);
        readAsLocal = parsed.zoneApplied;
      }

      const { regimen, dose, planned, alreadyRecorded } = await logDose(supabase, {
        regimenId: args.regimen_id,
        at: at.toISOString(),
        amount: args.amount ?? null,
        status: args.status,
        note: args.note ?? null,
      });

      const intake = dose.planned_intake?.intake;
      // The time goes back in the caller's zone, carrying its offset, and names
      // the zone -- an intake quoted in UTC reads to the person as a dose taken
      // seven hours from when they took it.
      const when = `${formatZoned(at, timezone)} (${timezone}${readAsLocal ? ", as given" : ""})`;
      const zonedDose = withZonedTimestamps(
        dose as unknown as Record<string, unknown>,
        timezone,
        DOSE_EVENT_TIMESTAMPS,
      );

      // Reporting "logged" for a dose already on record invites the caller to
      // believe something was written, and a retry would cost one intake and
      // one stock decrement too many.
      if (alreadyRecorded) {
        return ok(
          `${regimen.custom_name} was already recorded as ${dose.status} at ${when}` +
            `, so nothing was written. Pass a different taken_at for a separate ` +
            `intake, or status: "${args.status === "taken" ? "skipped" : "taken"}" to correct it.`,
          {
            medication: regimen,
            dose: zonedDose,
            planned,
            timezone,
            already_recorded: true,
          },
        );
      }

      return ok(
        `Logged ${intake ? `${intake.amount} ${intake.unit} of ` : ""}${regimen.custom_name} as ` +
          `${dose.status} at ${when}. ` +
          `${planned ? "This resolved the dose already on the plan for that time." : "Recorded as an extra intake outside the plan."}`,
        {
          medication: regimen,
          dose: zonedDose,
          planned,
          timezone,
          already_recorded: false,
        },
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

        // Naming the zone matters most on this tool: a schedule is local
        // wall-clock times, and regeneration is what turns them into instants.
        // A caller that misread an existing time as UTC and "corrected" the
        // schedule by the offset would move every future reminder of the
        // course, so the reply says which zone the new plan was timed in.
        return ok(
          `Updated ${regimen.custom_name} (now ${regimen.effective_status}) and regenerated ${regenerated.result.eventsGenerated} upcoming intake(s) (timezone ${regenerated.result.timezone}).`,
          { medication: regimen, dose_events: regenerated.result },
        );
      },
      WRITE_SCOPE,
    ),
  );
}
