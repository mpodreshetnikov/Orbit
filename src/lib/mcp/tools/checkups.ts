import { z } from "zod";
import {
  getCheckup,
  latestCompletionDay,
  listCheckups,
  loadCheckupItem,
  markCheckupDone,
  normalizeReminderDays,
  scheduleColumnFromWrite,
  updateCheckupSchedule,
  type CheckupScheduleWrite,
} from "../health/checkups";
import { isoDateSchema, personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson, withUserClient } from "../tool-context";
import { fail, ok, summarizeList } from "../tool-result";
import { WRITE_SCOPE } from "./scopes";
import type { McpToolServer } from "./types";

const scheduleWriteSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    every: z.number().int().min(1).max(120),
    unit: z.enum(["week", "month", "year"]),
    first_due_at: isoDateSchema
      .nullable()
      .optional()
      .describe(
        "When the series should next fall due (sets the interval anchor), only when this checkup has no completions yet. Omit to keep the existing anchor. Refused after completions exist — the next due advances from the latest done day.",
      ),
    next_due_from: z
      .enum(["completion", "target"])
      .optional()
      .describe(
        "After a completion: advance from the done date (completion, default) or from the previous due target (target).",
      ),
  }),
  z.object({
    type: z.literal("one_off"),
    due_at: isoDateSchema.describe("The single due date (YYYY-MM-DD)."),
  }),
]);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function describeSchedule(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "unknown schedule";
  const s = schedule as Record<string, unknown>;
  if (s.type === "one_off") return `one-off due ${String(s.due_at ?? "?")}`;
  if (s.type === "interval") {
    const every = s.every ?? "?";
    const unit = s.unit ?? "?";
    const from = s.next_due_from ? `, next from ${String(s.next_due_from)}` : "";
    const anchor = s.anchor_date ? `, anchor ${String(s.anchor_date)}` : "";
    return `every ${every} ${unit}${from}${anchor}`;
  }
  return "unknown schedule";
}

/** Checkups: recurring screening reminders and their completion log. */
export function registerCheckupTools(server: McpToolServer): void {
  server.registerTool(
    "list_checkups",
    {
      title: "List checkups",
      description:
        "List a person's scheduled checkups and screenings with their next due date, flagging which are overdue. Use due_window='overdue' for 'what am I behind on?'.",
      inputSchema: z.object({
        ...personSelectorSchema,
        category: z.enum(["lab", "imaging", "visit", "vaccination", "dental", "other"]).optional(),
        status: z.enum(["active", "paused", "completed", "archived"]).optional(),
        due_window: z
          .enum(["overdue", "upcoming", "all"])
          .default("all")
          .describe("Restrict to overdue or still-upcoming checkups."),
        due_before: isoDateSchema
          .optional()
          .describe("Only checkups due on or before this date (YYYY-MM-DD)."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const checkups = await listCheckups(supabase, {
        personId: person.id,
        category: args.category,
        status: args.status,
        dueWindow: args.due_window,
        dueBefore: args.due_before,
      });

      const overdueCount = checkups.filter((checkup) => checkup.is_overdue).length;

      return ok(
        summarizeList(
          `checkups for ${person.name}${overdueCount ? ` (${overdueCount} overdue)` : ""}`,
          checkups.map(
            (checkup) =>
              `${checkup.title} — ${checkup.category}, ${checkup.status}` +
              `${checkup.next_due_at ? `, due ${checkup.next_due_at}` : ", no due date"}` +
              `${checkup.is_overdue ? ` [OVERDUE by ${Math.abs(checkup.days_until_due ?? 0)} days]` : ""}` +
              ` (id ${checkup.id})`,
          ),
          checkups.length,
        ),
        { person, checkups, overdue_count: overdueCount },
      );
    }),
  );

  server.registerTool(
    "get_checkup",
    {
      title: "Get checkup",
      description:
        "Get one checkup in detail: its schedule, why it was set up, and the full log of times it has been completed.",
      inputSchema: z.object({ checkup_id: uuidSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient<{ checkup_id: string }>(async (supabase, args) => {
      const detail = await getCheckup(supabase, args.checkup_id);
      if (!detail.checkup) {
        return fail(`No checkup with id ${args.checkup_id}.`);
      }

      const checkup = detail.checkup as Record<string, unknown>;
      return ok(
        `${checkup.title as string} (${checkup.category as string}, ${checkup.status as string})` +
          `${checkup.next_due_at ? `, next due ${checkup.next_due_at as string}` : ""}. ` +
          `${detail.completions.length} completion(s) logged.`,
        { checkup, completions: detail.completions },
      );
    }),
  );

  server.registerTool(
    "mark_checkup_done",
    {
      title: "Mark checkup done",
      description:
        "Log that a scheduled checkup was completed on a given day (defaults to today). The database advances next_due_at for interval schedules or marks a one-off completed. For a done_at before today (a backdate), call once without confirm to preview, then again with confirm=true after the owner agrees — nothing is written on the preview call. Mobile one-tap complete remains available; this is the agent path.",
      inputSchema: z.object({
        checkup_id: uuidSchema.describe("From list_checkups or get_checkup."),
        done_at: isoDateSchema
          .optional()
          .describe("Completion day as YYYY-MM-DD. Defaults to today (UTC date)."),
        note: z.string().optional().describe("Optional short note about the completion."),
        evidence_record_id: uuidSchema
          .nullable()
          .optional()
          .describe("Optional medical record that documents this completion."),
        confirm: z
          .boolean()
          .optional()
          .describe(
            "Required true when done_at is before today. Omit or false on the preview call for a backdate.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withUserClient<{
      checkup_id: string;
      done_at?: string;
      note?: string;
      evidence_record_id?: string | null;
      confirm?: boolean;
    }>(async (supabase, args) => {
      const doneAt = args.done_at?.trim() ? args.done_at.trim().slice(0, 10) : todayUtc();
      const today = todayUtc();
      const isBackdate = doneAt < today;
      const latestDone = await latestCompletionDay(supabase, args.checkup_id);
      if (latestDone && doneAt < latestDone) {
        return fail(
          `done_at ${doneAt} is before the latest completion on ${latestDone}. ` +
            `Logging an older completion would move next_due_at backwards; omit done_at or use a day on or after ${latestDone}.`,
        );
      }

      if (isBackdate && args.confirm !== true) {
        const checkup = await loadCheckupItem(supabase, args.checkup_id);
        if (!checkup) {
          return fail(`No checkup with id ${args.checkup_id}.`);
        }
        return ok(
          `Preview only — nothing written. Mark "${checkup.title}" done on ${doneAt} (before today ${today}). ` +
            `Current next due: ${checkup.next_due_at ?? "none"}. Ask the owner to confirm, then call again with the same arguments and confirm=true.`,
          {
            needs_confirm: true,
            reason: "backdate",
            checkup,
            proposed: {
              done_at: doneAt,
              note: args.note ?? null,
              evidence_record_id: args.evidence_record_id ?? null,
            },
          },
        );
      }

      const result = await markCheckupDone(supabase, {
        checkupId: args.checkup_id,
        doneAt,
        note: args.note ?? null,
        evidenceRecordId: args.evidence_record_id ?? null,
      });

      return ok(
        `Marked "${result.checkup.title}" done on ${result.completion.done_at}. ` +
          `Next due: ${result.checkup.next_due_at ?? "none"} (${result.checkup.status}).`,
        { checkup: result.checkup, completion: result.completion },
      );
    }, WRITE_SCOPE),
  );

  server.registerTool(
    "update_checkup_schedule",
    {
      title: "Update checkup schedule",
      description:
        "Change an existing checkup's recurrence or one-off due date (and optionally reminder lead days). Call once without confirm to preview current vs proposed; call again with confirm=true to write. Does not create a new checkup — use propose_checkup for that. Does not pause or archive.",
      inputSchema: z.object({
        checkup_id: uuidSchema.describe("From list_checkups or get_checkup."),
        schedule: scheduleWriteSchema,
        reminder_days_before: z
          .array(z.number().int().min(0).max(365))
          .max(10)
          .nullable()
          .optional()
          .describe(
            "Days before due to remind (furthest first after write). Pass null or [] to clear (stored as empty array); omit to leave unchanged.",
          ),
        confirm: z
          .boolean()
          .optional()
          .describe("Required true to apply. Omit or false returns a preview and writes nothing."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    withUserClient<{
      checkup_id: string;
      schedule: CheckupScheduleWrite;
      reminder_days_before?: number[] | null;
      confirm?: boolean;
    }>(async (supabase, args) => {
      const checkup = await loadCheckupItem(supabase, args.checkup_id);
      if (!checkup) {
        return fail(`No checkup with id ${args.checkup_id}.`);
      }
      if (checkup.status === "archived") {
        return fail(
          `Checkup "${checkup.title}" is archived; restore it in the app before editing its schedule.`,
        );
      }

      const proposedSchedule = scheduleColumnFromWrite(args.schedule, checkup.schedule);
      const normalizedReminders = normalizeReminderDays(args.reminder_days_before);
      const proposedReminders =
        normalizedReminders === undefined ? checkup.reminder_days_before : normalizedReminders;

      if (args.confirm !== true) {
        return ok(
          `Preview only — nothing written. "${checkup.title}" schedule: ${describeSchedule(checkup.schedule)} → ${describeSchedule(proposedSchedule)}. ` +
            `Reminders: ${JSON.stringify(checkup.reminder_days_before)} → ${JSON.stringify(proposedReminders)}. ` +
            `Ask the owner to confirm, then call again with the same arguments and confirm=true.`,
          {
            needs_confirm: true,
            checkup,
            proposed: {
              schedule: proposedSchedule,
              reminder_days_before: proposedReminders,
            },
          },
        );
      }

      const result = await updateCheckupSchedule(supabase, {
        checkupId: args.checkup_id,
        schedule: args.schedule,
        reminderDaysBefore: args.reminder_days_before,
      });

      return ok(
        `Updated schedule for "${result.after.title}": ${describeSchedule(result.after.schedule)}. ` +
          `Next due: ${result.after.next_due_at ?? "none"}.`,
        { before: result.before, after: result.after },
      );
    }, WRITE_SCOPE),
  );
}
