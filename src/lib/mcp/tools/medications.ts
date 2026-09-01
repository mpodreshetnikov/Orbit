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
import { formatZoned, instantFromInput, withZonedTimestamps, zonedIso } from "../zoned-time";
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
import { fail, ok, summarizePage } from "../tool-result";
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
function describeIntake(
  planned: PlannedIntake | null | undefined,
  course?: PlannedIntake | null,
  courseSchedule?: MedSchedule | null,
): string {
  const intake = planned?.intake;

  // `planned_intake` and `dose_definition` are jsonb with no shape constraint,
  // and every row of every listing passes through here. A legacy or imported
  // row whose `active` is not an array must not throw and take down the reply
  // for the medications around it, so the shape is checked rather than trusted.
  const active = Array.isArray(planned?.active) ? planned.active : [];
  const named = active.filter(
    (one) => one && typeof one === "object" && one.name != null && one.amount != null,
  );
  // Bounded for the same reason notes are: a combination product can carry a
  // long list, an imported row can carry a longer one, and a page holds up to a
  // hundred rows. `structuredContent` keeps the whole array.
  // Every part of the rendering is bounded, not just the name: `unit` and
  // `amount` are `z.string()`/`z.number()` against a jsonb column with no shape
  // constraint, so an imported row can carry a unit as long as a note. The
  // whole rendered ingredient is cut, which bounds all three at once.
  const ingredients = named
    .slice(0, INGREDIENT_LIMIT)
    .map((one) =>
      excerpt(
        `${excerpt(String(one.name), INGREDIENT_NAME_LIMIT)} ${one.amount}${one.unit ? ` ${one.unit}` : ""}`,
        INGREDIENT_TEXT_LIMIT,
      ),
    );
  if (named.length > ingredients.length) {
    ingredients.push(`…${named.length - ingredients.length} more`);
  }

  // `active` is milligrams per intake with nothing recording what one unit
  // contains, and nothing rescales it: the generator copies it while
  // overriding a slot's amount, and `logDose` keeps it when a caller corrects
  // one. So an intake whose amount differs from its course's carries a total
  // recorded for some other number of units, and printing it plainly would
  // state a dose the record does not support -- the failure this whole task
  // exists to close.
  //
  // Nor can the difference be explained away by naming the course's amount:
  // `dose_definition` is edited in place and only future unresolved events are
  // regenerated, so a past intake sits beside a definition that may have moved
  // under it. The row cannot tell which case it is in, so it says the
  // milligrams for this amount are not on file rather than picking one.
  //
  // Nor is equality with the course's current amount enough on a course whose
  // schedule overrides the amount per slot. An event generated from a 2-pill
  // slot of a 1-pill course stores 2 pills beside the 1-pill course's
  // milligrams; if the course's own amount is later edited to 2, the two
  // numbers match and the stale copy would read as verified. Where any slot
  // overrides the amount, an event that matches the definition cannot be told
  // from one that was generated against a different one, so the strength is
  // withheld there too.
  const courseAmount = course?.intake?.amount;
  const unverifiable =
    ingredients.length > 0 &&
    courseAmount != null &&
    intake?.amount != null &&
    (courseAmount !== intake.amount || overridesAmount(courseSchedule, courseAmount));
  const strength =
    ingredients.length === 0
      ? ""
      : unverifiable
        ? " (strength not recorded for this amount)"
        : ` (${ingredients.join(" + ")})`;

  if (!intake || intake.amount == null) {
    return strength ? `dose unknown${strength}` : "";
  }
  return `${intake.amount} ${unitText(intake.unit)}`.trim() + strength;
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
  // A `for_days` course may omit its start date; the generator infers one from
  // the earliest event, `created_at` or today, so the course is bounded even
  // though no window can be computed from the row. Saying how long it runs
  // beats saying nothing about its duration at all.
  if (duration?.type === "for_days" && typeof duration.days === "number") {
    return `for ${duration.days} days (start date not recorded)`;
  }
  return "";
}

/**
 * The plan's own times, which are local wall-clock strings on the regimen
 * rather than instants -- labelled as such, since the same reply quotes real
 * instants converted into a named zone (T-0027).
 */
function describeSchedule(
  schedule: MedSchedule | null | undefined,
  dose?: PlannedIntake | null,
  timezone?: string,
): string {
  if (!schedule) return "schedule unknown";

  // Every field is read defensively: these are jsonb columns whose shape is a
  // TypeScript promise rather than a database constraint, and a row written
  // before a mode gained a field would otherwise throw here and take the whole
  // reply down -- on a list where the other medications are fine.
  //
  // A slot's own amount wins over the course's default, and the generator
  // honours it: half a pill in the morning and one and a half at night is one
  // regimen with two amounts, and printing the base dose beside bare times
  // would describe both slots as the same size.
  // A slot amount that differs from the course's own means the strength printed
  // beside the dose was recorded for a different number of units, and nothing
  // rescales it -- the same reason an intake withholds its milligrams when the
  // amounts disagree. Saying so once per schedule keeps the two surfaces
  // consistent instead of letting a reader carry the base strength onto an
  // overridden slot.
  const overrideNote = () => {
    const base = dose?.intake?.amount;
    const hasStrength = Array.isArray(dose?.active) && dose.active.length > 0;
    const amounts = scheduleAmounts(schedule);
    if (!hasStrength || base == null || amounts.length === 0) return "";
    return amounts.some((amount) => amount != null && amount !== base)
      ? `, strength on file is for the ${base} ${unitText(dose?.intake?.unit)} dose only`.replace(
          "  ",
          " ",
        )
      : "";
  };

  const at = () => {
    const slots = effectiveSlots(schedule);
    if (slots.length === 0) return "";
    const unit = unitText(dose?.intake?.unit);
    // Each slot is cut as well as the list: `times` is jsonb, so one entry can
    // be as long as a note, and bounding only their number would still let a
    // single value fill the reply.
    const rendered = slots.map((slot) =>
      excerpt(
        slot.amount == null ? slot.time : `${slot.time} (${slot.amount}${unit ? ` ${unit}` : ""})`,
        SLOT_TEXT_LIMIT,
      ),
    );
    return (
      ` at ${joinBounded(rendered, SCHEDULE_SLOT_LIMIT)} (local wall clock)` +
      (hasDuplicateTimes(schedule)
        ? " — repeated times collapsed, since only one dose per minute is generated"
        : "")
    );
  };

  switch (schedule.mode) {
    case "daily_times":
      return `schedule daily_times${at()}${overrideNote()}`;
    case "interval_hours":
      return (
        `schedule interval_hours every ${intervalText(schedule.interval?.every)}h` +
        // The generator reads `every` as text and casts it to `int`
        // (`(v_schedule->'interval'->>'every')::int`), which a fractional value
        // does not survive -- and `medScheduleSchema` requires a whole number of
        // days for `interval_days` but not of hours here, so `every: 1.5` is
        // writable and generates nothing at all. Printing it as the plan would
        // describe doses that are never made.
        `${typeof schedule.interval?.every === "number" && !Number.isInteger(schedule.interval.every) ? " — not generated: the interval must be a whole number of hours" : ""}` +
        `${typeof schedule.amount === "number" && schedule.amount > 0 ? ` (${schedule.amount}${unitText(dose?.intake?.unit) ? ` ${unitText(dose?.intake?.unit)}` : ""} per intake)` : ""}` +
        // A scalar override is the same claim as a per-slot one, so it earns the
        // same warning: the generator replaces the amount and copies `active`.
        `${overrideNote()}`
      );
    case "interval_days": {
      // `time_of_day` is the deprecated single-time form, and the generator
      // still reads it, so a legacy row doses at a time this line would
      // otherwise not mention at all. With neither field the generator does not
      // give up either -- it substitutes `09:00`
      // (`COALESCE(v_schedule->>'time_of_day', '09:00')`) and doses then, so
      // reporting no time would deny an intake the reminders do make.
      const stored =
        (Array.isArray(schedule.times) && schedule.times.length > 0) ||
        typeof schedule.time_of_day === "string";
      return (
        `schedule interval_days every ${intervalText(schedule.interval?.every)}d` +
        `${at()}` +
        `${stored ? "" : " — no time recorded, so the generator uses its default"}` +
        `${overrideNote()}`
      );
    }
    case "days_of_week":
      return `schedule days_of_week${Array.isArray(schedule.days_of_week) && schedule.days_of_week.length > 0 ? ` on ${joinBounded(schedule.days_of_week.map(weekdayName), SCHEDULE_SLOT_LIMIT)}` : ""}${at()}${overrideNote()}`;
    case "one_off":
      // The due instant is a timestamp, so it is quoted only where a zone has
      // been resolved (T-0027: a time this server prints is converted and
      // labelled, or it is not printed). `list_medications` resolves none, and
      // says where to find it rather than rendering it in UTC.
      // `formatZoned` echoes a value it cannot parse, and `due_at` is an
      // unrestricted string on a jsonb column, so a malformed row would print
      // itself -- unbounded, once per listing row -- under a heading that says
      // it is a time. A value that is not an instant is named as such instead.
      return (
        "schedule one_off" +
        (typeof schedule.due_at === "string"
          ? !timezone
            ? ", due time in the payload"
            : zonedIso(schedule.due_at, timezone)
              ? `, due ${formatZoned(schedule.due_at, timezone)}`
              : ", due time not recorded as a timestamp"
          : "")
      );
    default:
      return "schedule unknown";
  }
}

/**
 * When a dose is actually due.
 *
 * `actual_at` is the effective time, not a copy of `scheduled_at`: the
 * generator writes the two equal, and `snooze_dose.sql` moves `actual_at` alone
 * -- which is then the time the reminder query fires on and the dashboard sorts
 * and displays by. Printing `scheduled_at` would report a dose snoozed from
 * 09:00 to 11:00 as due at 09:00, contradicting the app the owner is looking at.
 */
function dueAt(dose: { scheduled_at: string; actual_at?: string | null }): string {
  return dose.actual_at ?? dose.scheduled_at;
}

/**
 * The resolution timestamp, labelled by what actually happened.
 *
 * `taken_at` is not evidence of an intake. `mark_dose_skipped.sql` sets it to
 * the resolution time as well (`taken_at = COALESCE(actual_at, now())`), so an
 * unconditional "taken" renders a skipped dose as `[skipped], taken 09:00` --
 * which in a medication history reads as proof the dose was swallowed.
 */
function describeResolution(
  dose: { status: string; taken_at?: string | null },
  timezone: string,
): string {
  if (!dose.taken_at) return "";
  const label =
    dose.status === "taken" ? "taken" : dose.status === "skipped" ? "marked skipped" : "resolved";
  return `, ${label} ${formatZoned(dose.taken_at, timezone)}`;
}

/** Stock on hand, when the course tracks it. */
function describeStock(regimen: RegimenWithStatus): string {
  const inventory = regimen.inventory;
  if (!inventory?.enabled || inventory.current_amount == null) return "";
  return `stock ${inventory.current_amount} ${unitText(inventory.unit ?? regimen.intake_unit)}`;
}

/**
 * A note, flattened to one line and bounded.
 *
 * Notes are free text with no length limit in the database -- an imported one
 * can be pages long -- and a reply can carry a hundred of them. Left whole they
 * would crowd out the answer they were meant to support, so the text block gets
 * an excerpt with an explicit marker and `structuredContent` keeps the note
 * itself.
 */
function excerpt(text: string | null | undefined, limit: number): string {
  const oneLine = text?.trim().replace(/\s+/g, " ");
  if (!oneLine) return "";
  return oneLine.length > limit ? `${oneLine.slice(0, limit)}…` : oneLine;
}

/** How much of a note each surface spells out before cutting it. */
const NOTE_EXCERPT = { list: 80, dose: 120, detail: 400 } as const;

/** How many active ingredients a line names, and how long each name may be. */
const INGREDIENT_LIMIT = 4;
const INGREDIENT_NAME_LIMIT = 60;
const INGREDIENT_TEXT_LIMIT = 90;
const UNIT_LIMIT = 24;

/**
 * A unit, bounded.
 *
 * `unit` is an unrestricted string on `dose_definition`, on `inventory` and on
 * `med_inventory_transactions.unit` (plain `text`), and it is the most repeated
 * field this server renders: once per slot of a schedule, once per movement of
 * a ledger, once per row of a page. A real unit is "pill" or "milligram", so a
 * cut at 24 characters only ever fires on a row that was never readable.
 */
function unitText(unit: unknown): string {
  return unit == null ? "" : excerpt(String(unit), UNIT_LIMIT);
}
const SCHEDULE_SLOT_LIMIT = 12;
const SLOT_TEXT_LIMIT = 32;

/**
 * Joins rendered parts, keeping the first `limit` and saying how many were
 * dropped.
 *
 * The schedule's `times`, its `amounts` and its `days_of_week` are jsonb with
 * no maximum in the database and none in `medScheduleSchema` either, so a
 * single valid write can put thousands of slots into a row that a listing then
 * renders a hundred times over. The count keeps the omission visible, which is
 * what the truncation rule asks for.
 */
function joinBounded(parts: string[], limit: number): string {
  if (parts.length <= limit) return parts.join(", ");
  return [...parts.slice(0, limit), `…${parts.length - limit} more`].join(", ");
}

/**
 * The per-intake amounts a schedule sets for itself, overriding the course's.
 *
 * Read defensively: `schedule` is jsonb, so `amounts` can be a string or hold
 * nulls on an imported row, and a non-number there must not be compared as if
 * it were one.
 */
type ScheduleSlot = { time: string; amount?: number };

/**
 * The slots a schedule actually doses, as the generator derives them.
 *
 * Three differences from reading `times` and `amounts` straight off the row,
 * each of which the text got wrong on its own:
 *
 * - An `interval_days` course with no `times` still doses: the generator
 *   substitutes `time_of_day`, or `09:00`, and makes one slot from it.
 * - `amounts` pairs with the slots by index
 *   (`v_schedule->'amounts'->(v_slot.idx - 1)`), so entries past the last slot
 *   are never dosed and are not overrides.
 * - A repeated time is one dose, not two. The generator loops every slot, but
 *   its `NOT EXISTS` guard and `idx_med_dose_events_regimen_scheduled_minute`
 *   let only the first event exist at a given regimen-minute, so
 *   `times: ["08:00", "08:00"], amounts: [1, 2]` doses once, at 1.
 */
function effectiveSlots(schedule?: MedSchedule | null): ScheduleSlot[] {
  if (!schedule || typeof schedule !== "object") return [];
  if (schedule.mode === "interval_hours") return [];
  const stored = (schedule as { times?: unknown }).times;
  const times: unknown[] = Array.isArray(stored) && stored.length > 0 ? stored : [];
  const withFallback =
    times.length === 0 && schedule.mode === "interval_days"
      ? [
          typeof (schedule as { time_of_day?: unknown }).time_of_day === "string"
            ? (schedule as { time_of_day: string }).time_of_day
            : GENERATOR_DEFAULT_TIME,
        ]
      : times;
  const amounts = (schedule as { amounts?: unknown }).amounts;
  const seen = new Set<string>();
  const slots: ScheduleSlot[] = [];
  withFallback.forEach((time, index) => {
    const text = typeof time === "string" ? time : String(time);
    if (seen.has(text)) return;
    seen.add(text);
    const amount = Array.isArray(amounts) ? amounts[index] : undefined;
    // Only a positive amount is an amount: the generator replaces a zero or
    // negative slot value with the course's own
    // (`IF v_slot_amount IS NULL OR v_slot_amount <= 0`), so rendering `0 pill`
    // would report a dose the reminders never carry, and counting it as an
    // override would withhold a strength for a slot that doses the base amount.
    slots.push({
      time: text,
      amount: typeof amount === "number" && amount > 0 ? amount : undefined,
    });
  });
  return slots;
}

/** The per-intake amounts a schedule doses, overriding the course's own. */
function scheduleAmounts(schedule?: MedSchedule | null): number[] {
  if (!schedule || typeof schedule !== "object") return [];
  if (schedule.mode === "interval_hours") {
    // Same rule as a slot amount: the generator falls back to the course's own
    // amount for anything not positive.
    return typeof schedule.amount === "number" && schedule.amount > 0 ? [schedule.amount] : [];
  }
  return effectiveSlots(schedule)
    .map((slot) => slot.amount)
    .filter((one): one is number => typeof one === "number");
}

/** Whether a schedule stores more time slots than it can dose. */
function hasDuplicateTimes(schedule?: MedSchedule | null): boolean {
  const stored = (schedule as { times?: unknown } | null | undefined)?.times;
  return Array.isArray(stored) && stored.length > effectiveSlots(schedule).length;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * An interval, or `?` where the row does not hold one.
 *
 * `interval.every` is a number in the schema and unconstrained jsonb in the
 * column, so an imported row can carry a string as long as a note there — and
 * this value is interpolated into every listing line for that course. A
 * non-finite value is not an interval anyway: the generator casts it and
 * generates nothing.
 */
function intervalText(every: unknown): string {
  return typeof every === "number" && Number.isFinite(every) ? String(every) : "?";
}

/** The time the generator doses an `interval_days` course at when the row records none. */
const GENERATOR_DEFAULT_TIME = "09:00";

/**
 * A weekday index as a name, or as a day that never doses.
 *
 * `on 0, 1` is only unambiguous to a reader who knows this domain counts from
 * Sunday, and a reader who assumes Monday shifts the whole schedule by a day.
 *
 * `7` is not Sunday here, however plausible it looks: the generator maps
 * `isodow` 7 to 0 before testing membership (`v_days_of_week @> to_jsonb(v_dow)`),
 * so a stored `7` matches no day and the course doses on it never.
 * `regimen-card.tsx` prints it as Sunday; repeating that promise in a reply
 * would describe intakes the app and the reminders never make.
 */
function weekdayName(day: unknown): string {
  return typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6
    ? WEEKDAYS[day]
    : `${excerpt(String(day), UNIT_LIMIT)} (never dosed)`;
}

/** Whether any slot doses a different amount than the course's own. */
function overridesAmount(schedule: MedSchedule | null | undefined, base?: number): boolean {
  if (base == null) return false;
  return scheduleAmounts(schedule).some((amount) => amount !== base);
}

/** A course note, kept short enough for a list line. */
function describeNotesExcerpt(notes: string | null): string {
  const text = excerpt(notes, NOTE_EXCERPT.list);
  return text ? `note "${text}"` : "";
}

function describeRegimen(regimen: RegimenWithStatus, timezone?: string): string {
  // Every part the tool's own description promises -- "dose, schedule, duration
  // and stock" -- plus the note, which is where a tablet strength tends to be
  // written down while `active` is empty.
  const parts = [
    describeIntake(regimen.dose_definition),
    describeSchedule(regimen.schedule, regimen.dose_definition, timezone),
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
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone a one-off course's due time is reported in, e.g. 'Europe/Berlin'. Defaults to the user's saved preference, or UTC.",
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args, auth) => {
      // Resolved even though most schedules carry no instant: a `one_off`
      // course's `due_at` is one, and T-0027's contract is that a time this
      // server prints is converted and labelled or it is not printed at all.
      const zone = await resolveDisplayZone(supabase, auth.authUserId, args.timezone);
      if (!zone.ok) {
        return fail(zone.error);
      }

      const { regimens, total } = await listMedications(supabase, {
        personId: person.id,
        status: args.status,
        search: args.search,
        includeArchived: args.include_archived,
        limit: args.limit,
        offset: args.offset,
      });

      // Both the page and the total come from the query. Filtering or slicing
      // afterwards would page a result PostgREST had already truncated at
      // `max_rows`, stranding the oldest courses behind a reply that claimed
      // there was nothing more.
      const hasMore = args.offset + regimens.length < total;
      const nextOffset = hasMore ? args.offset + regimens.length : null;

      return ok(
        summarizePage(
          `medications for ${person.name}`,
          regimens.map((regimen) => describeRegimen(regimen, zone.timezone)),
          {
            total,
            offset: args.offset,
            has_more: hasMore,
            next_offset: nextOffset,
          },
        ),
        {
          person,
          medications: regimens,
          total,
          limit: args.limit,
          offset: args.offset,
          has_more: hasMore,
          next_offset: nextOffset,
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
        inventory_offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Stock movements to skip, newest first, for reading older ledger entries."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient<{
      regimen_id: string;
      horizon_days: number;
      timezone?: string;
      inventory_offset: number;
    }>(async (supabase, args, auth) => {
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
        inventoryOffset: args.inventory_offset,
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

      const courseDose = detail.regimen.dose_definition;
      const courseSchedule = detail.regimen.schedule;
      // A truncated ledger says how to read the rest, like every other list
      // this server pages (ADR-260829-ube): the movements are newest first,
      // so an offset walks backwards through the history.
      const shownMovements = args.inventory_offset + detail.inventoryTransactions.length;
      const inventoryWindow =
        detail.inventoryTotal > shownMovements || args.inventory_offset > 0
          ? ` (${args.inventory_offset + 1}-${shownMovements} of ${detail.inventoryTotal}, newest first` +
            `${detail.inventoryTotal > shownMovements ? `; pass inventory_offset: ${shownMovements} for older` : ""})`
          : "";
      const next = detail.upcomingDoses[0];
      const previous = detail.recentDoses[detail.recentDoses.length - 1];

      // The description promises detail, and what this returned was one line
      // counting the doses -- strictly less than `list_medications` prints
      // for the same course. So the summary keeps the counts and the T-0027
      // zone contract, then actually says what the course is and lists the
      // doses and stock movements it is counting.
      const plan = [
        describeIntake(detail.regimen.dose_definition),
        describeSchedule(detail.regimen.schedule, detail.regimen.dose_definition, zone.timezone),
        describeCourseWindow(detail.regimen.duration),
        describeStock(detail.regimen),
      ].filter((part) => part.length > 0);

      const notes = excerpt(detail.regimen.notes, NOTE_EXCERPT.detail);
      // A 30-day horizon on a twice-daily course is 120 intakes. List the
      // ones nearest now and say how many were left out, rather than either
      // dumping all of them or going back to a bare count.
      // `total`, not `rows.length`: the query is bounded, so counting the rows
      // it returned would report its own page as the whole horizon -- the
      // truncation-as-total defect the listings were fixed for.
      const listed = <T>(rows: T[], total: number, keep: "first" | "last") => {
        const shown =
          rows.length <= DETAIL_DOSE_LIMIT
            ? rows
            : keep === "first"
              ? rows.slice(0, DETAIL_DOSE_LIMIT)
              : rows.slice(-DETAIL_DOSE_LIMIT);
        return { rows: shown, omitted: Math.max(0, total - shown.length) };
      };
      const recent = listed(detail.recentDoses, detail.recentTotal, "last");
      const upcoming = listed(detail.upcomingDoses, detail.upcomingTotal, "first");
      // An omitted row needs a way back, like every other truncation this
      // server prints: `list_medication_doses` takes this course's id and a
      // range, so the pointer names the tool and the argument rather than
      // leaving a count nothing can act on.
      const more = (omitted: number) =>
        omitted > 0
          ? `\n- ...${omitted} more; call list_medication_doses with regimen_id: ${args.regimen_id}` +
            ` and a from/to range for them`
          : "";
      const doseLine = (dose: (typeof detail.upcomingDoses)[number]) =>
        `- ${formatZoned(dueAt(dose), zone.timezone)} — ${describeIntake(dose.planned_intake, courseDose, courseSchedule) || "dose unknown"} [${dose.status}]` +
        `${dueAt(dose) !== dose.scheduled_at ? `, moved from ${formatZoned(dose.scheduled_at, zone.timezone)}` : ""}` +
        `${describeResolution(dose, zone.timezone)}` +
        `${excerpt(dose.note, NOTE_EXCERPT.dose) ? `, note "${excerpt(dose.note, NOTE_EXCERPT.dose)}"` : ""}`;
      const movementLine = (movement: (typeof detail.inventoryTransactions)[number]) =>
        `- ${formatZoned(movement.created_at, zone.timezone)} — ${movement.type} ${movement.amount} ${unitText(movement.unit)}` +
        `${excerpt(movement.note, NOTE_EXCERPT.dose) ? `, note "${excerpt(movement.note, NOTE_EXCERPT.dose)}"` : ""}`;

      return ok(
        `${detail.regimen.custom_name} — ${detail.regimen.effective_status}. ` +
          `${detail.upcomingTotal} upcoming dose(s), ${detail.recentTotal} in the recent window. ` +
          `Times are ${zone.timezone}` +
          `${next ? `; next ${formatZoned(dueAt(next), zone.timezone)}` : ""}` +
          `${previous ? `; last ${formatZoned(previous.taken_at ?? dueAt(previous), zone.timezone)}` : ""}.` +
          `\n${plan.join(", ")}.` +
          `${notes ? `\nNotes: ${notes}` : ""}` +
          `${recent.rows.length > 0 ? `\nRecent intakes:${more(recent.omitted)}\n${recent.rows.map(doseLine).join("\n")}` : ""}` +
          `${upcoming.rows.length > 0 ? `\nUpcoming intakes:\n${upcoming.rows.map(doseLine).join("\n")}${more(upcoming.omitted)}` : ""}` +
          `${
            detail.inventoryTransactions.length > 0
              ? `\nInventory movements${inventoryWindow}:\n${detail.inventoryTransactions.map(movementLine).join("\n")}`
              : detail.inventoryTotal > 0
                ? // An offset at or past the end -- asked for directly, or
                  // reached after movements were removed between two
                  // continuation calls -- returns no rows beside a positive
                  // total. Dropping the section there would answer a question
                  // about the stock history with silence, which is the failure
                  // the paging rule exists to prevent, so it says where the
                  // last page starts instead.
                  `\nInventory movements: ${detail.inventoryTotal} recorded, but inventory_offset ${args.inventory_offset} is past the end. ` +
                  `Pass an offset below ${detail.inventoryTotal} — inventory_offset: 0 starts again from the newest.`
                : ""
          }`,
        {
          ...detail,
          timezone: zone.timezone,
          upcomingDoses: inZone(detail.upcomingDoses),
          recentDoses: inZone(detail.recentDoses),
          inventoryTransactions: detail.inventoryTransactions.map((transaction) =>
            withZonedTimestamps(transaction as unknown as Record<string, unknown>, zone.timezone, [
              "created_at",
            ]),
          ),
        } as unknown as Record<string, unknown>,
      );
    }),
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

      const { doses, total } = await listMedicationDoses(supabase, {
        personId: person.id,
        from: localDayStartUtc(args.from, timezone),
        to: localDayEndUtc(args.to, timezone),
        status: args.status,
        regimenId: args.regimen_id,
        limit: args.limit,
        offset: args.offset,
      });

      // The page and its total both come from the query, so a range wider than
      // PostgREST's `max_rows` reports what it really holds rather than
      // declaring its own truncation to be the end of the data.
      const hasMore = args.offset + doses.length < total;
      const nextOffset = hasMore ? args.offset + doses.length : null;

      return ok(
        summarizePage(
          `medication intakes for ${person.name} (${args.from} to ${args.to}, ${timezone})`,
          doses.map(
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
              `${formatZoned(dueAt(dose), timezone)} — ${dose.medication_name ?? "unknown"}` +
              `${describeIntake(dose.planned_intake, dose.medication_dose, dose.medication_schedule) ? `, ${describeIntake(dose.planned_intake, dose.medication_dose, dose.medication_schedule)}` : ""}` +
              ` [${dose.status}]` +
              `${dueAt(dose) !== dose.scheduled_at ? `, moved from ${formatZoned(dose.scheduled_at, timezone)}` : ""}` +
              `${describeResolution(dose, timezone)}` +
              `${excerpt(dose.note, NOTE_EXCERPT.dose) ? `, note "${excerpt(dose.note, NOTE_EXCERPT.dose)}"` : ""}`,
          ),
          {
            total,
            offset: args.offset,
            has_more: hasMore,
            next_offset: nextOffset,
          },
        ),
        {
          person,
          timezone,
          doses: doses.map((dose) =>
            withZonedTimestamps(
              dose as unknown as Record<string, unknown>,
              timezone,
              DOSE_EVENT_TIMESTAMPS,
            ),
          ),
          total,
          limit: args.limit,
          offset: args.offset,
          has_more: hasMore,
          next_offset: nextOffset,
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
        inventory: regimenInventorySchema
          .nullable()
          .optional()
          .describe(
            "Stock fields to change. Merged with what is stored, so a field you leave out keeps its value; pass null to stop tracking stock altogether.",
          ),
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
