import { z } from "zod";
import { getCheckup, listCheckups } from "../health/checkups";
import { isoDateSchema, personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson, withUserClient } from "../tool-context";
import { fail, ok, summarizeList } from "../tool-result";
import type { McpToolServer } from "./types";

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
}
