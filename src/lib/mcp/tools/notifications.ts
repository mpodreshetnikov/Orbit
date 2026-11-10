import { z } from "zod";
import { normalizeReminderTime } from "@/types/notification-routing";
import {
  getNotificationSettings,
  updateNotificationSettings,
} from "../health/notification-settings";
import { isValidTimeZone } from "../local-day";
import { uuidSchema } from "../schemas/common";
import { withUserClient } from "../tool-context";
import { fail, ok, summarizeList } from "../tool-result";
import { WRITE_SCOPE } from "./scopes";
import type { McpToolServer } from "./types";

function summarizeSettings(snapshot: Awaited<ReturnType<typeof getNotificationSettings>>): string {
  const { checkup_reminder: reminder, routing } = snapshot;
  const zone = reminder.timezone ?? "unset";
  const routingLines = routing.map((row) => {
    const state = row.enabled ? "on" : "off";
    const prefix = row.custom_prefix ? `, prefix "${row.custom_prefix}"` : "";
    return `${row.person_id} — ${state}${prefix}`;
  });
  return [
    `Checkup reminder at ${reminder.time} (${zone}).`,
    summarizeList("routing rows", routingLines, routing.length),
  ].join("\n");
}

/** Notification prefs: daily checkup reminder clock and who receives whose reminders. */
export function registerNotificationTools(server: McpToolServer): void {
  server.registerTool(
    "get_notification_settings",
    {
      title: "Get notification settings",
      description:
        "Read the account's checkup reminder time and timezone, plus notification_routing rows (which people's reminders reach this account and any title prefixes). Same surface as the phone Settings screen.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient(async (supabase, _args, auth) => {
      const snapshot = await getNotificationSettings(supabase, auth.authUserId);
      return ok(summarizeSettings(snapshot), { ...snapshot });
    }),
  );

  server.registerTool(
    "update_notification_settings",
    {
      title: "Update notification settings",
      description:
        "Change the checkup reminder time and/or timezone, and/or upsert notification_routing rows (enabled + optional custom_prefix per person). Pass at least one field. Requires health:write. Same prefs the phone Settings screen edits; the mobile UI stays.",
      inputSchema: z.object({
        checkup_reminder_time: z
          .string()
          .optional()
          .describe('Daily checkup reminder wall-clock time, e.g. "09:00" or "7:30".'),
        checkup_reminder_timezone: z
          .string()
          .nullable()
          .optional()
          .describe('IANA timezone for that reminder, e.g. "Europe/Moscow". Null clears it.'),
        routing: z
          .array(
            z.object({
              person_id: uuidSchema,
              enabled: z.boolean(),
              custom_prefix: z
                .string()
                .nullable()
                .optional()
                .describe("Title prefix for someone else's reminders; blank/null clears it."),
            }),
          )
          .min(1)
          .optional()
          .describe("Upsert one or more routing rows for this account as recipient."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withUserClient<{
      checkup_reminder_time?: string;
      checkup_reminder_timezone?: string | null;
      routing?: Array<{ person_id: string; enabled: boolean; custom_prefix?: string | null }>;
    }>(async (supabase, args, auth) => {
      const hasTime = args.checkup_reminder_time !== undefined;
      const hasZone = args.checkup_reminder_timezone !== undefined;
      const hasRouting = (args.routing?.length ?? 0) > 0;
      if (!hasTime && !hasZone && !hasRouting) {
        return fail(
          "Pass checkup_reminder_time, checkup_reminder_timezone, and/or routing — nothing to update.",
        );
      }

      if (hasZone && args.checkup_reminder_timezone) {
        const zone = args.checkup_reminder_timezone.trim();
        if (zone && !isValidTimeZone(zone)) {
          return fail(
            `Unknown timezone "${args.checkup_reminder_timezone}". Use an IANA name like Europe/Moscow.`,
          );
        }
      }

      const routing = args.routing?.map((row) => {
        const trimmed = row.custom_prefix?.trim() ?? "";
        return {
          person_id: row.person_id,
          enabled: row.enabled,
          custom_prefix: trimmed ? trimmed : null,
        };
      });

      const snapshot = await updateNotificationSettings(supabase, {
        authUserId: auth.authUserId,
        ...(hasTime
          ? { checkupReminderTime: normalizeReminderTime(args.checkup_reminder_time!) }
          : {}),
        ...(hasZone
          ? {
              checkupReminderTimezone: args.checkup_reminder_timezone?.trim()
                ? args.checkup_reminder_timezone.trim()
                : null,
            }
          : {}),
        ...(routing ? { routing } : {}),
      });

      return ok(`Updated notification settings.\n${summarizeSettings(snapshot)}`, { ...snapshot });
    }, WRITE_SCOPE),
  );
}
