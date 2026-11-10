import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  applyCheckupDraft,
  buildCreateCheckupDraft,
  buildEditCheckupDraft,
  checkupDraftSummaryText,
  checkupDraftTextFallbackInstructions,
  formatCheckupDraftMarkdown,
  type CheckupCreateDraftInput,
  type CheckupDraftMode,
  type CheckupEditDraftInput,
  type CheckupDraftView,
} from "../health/checkup-draft";
import { isoDateSchema, personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson } from "../tool-context";
import { fail, ok } from "../tool-result";
import { READ_SCOPE, WRITE_SCOPE } from "../tools/scopes";
import { MCP_APP_MIME_TYPE } from "./probe";
import { CHECKUP_DRAFT_HTML } from "./checkup-draft-page";

/**
 * Checkup create/edit as an MCP Apps card (T-261110-21n / ORB-43).
 *
 * Propose writes nothing and needs health:read. Confirm needs health:write and is the only
 * mutate path for these fields. Document-driven `propose_checkup` / `add_proposed_checkups`
 * stay for the record-draft card; this surface covers agent create + any-field edit.
 */

export const CHECKUP_DRAFT_RESOURCE_URI = "ui://orbit/checkup-draft.html";

const scheduleCreateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    every: z.number().int().min(1).max(120),
    unit: z.enum(["week", "month", "year"]),
  }),
  z.object({ type: z.literal("one_off"), due_at: isoDateSchema }),
]);

const scheduleEditSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    every: z.number().int().min(1).max(120),
    unit: z.enum(["week", "month", "year"]),
    first_due_at: isoDateSchema.nullable().optional(),
    next_due_from: z.enum(["completion", "target"]).optional(),
  }),
  z.object({ type: z.literal("one_off"), due_at: isoDateSchema }),
]);

const createDraftSchema = z.object({
  title: z.string().min(1).describe('As the owner would name it, e.g. "УЗИ щитовидной железы".'),
  category: z.enum(["lab", "imaging", "visit", "vaccination", "dental", "other"]),
  schedule: scheduleCreateSchema,
  first_due_at: isoDateSchema
    .nullable()
    .optional()
    .describe("For an interval: first due day. Without it, one interval from today."),
  why: z.string().min(1).describe("Why, in the owner's language."),
  condition_id: uuidSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  reminder_days_before: z.array(z.number().int().min(0).max(365)).max(10).nullable().optional(),
  evidence_record_id: uuidSchema.nullable().optional(),
});

const editDraftSchema = z.object({
  checkup_id: uuidSchema.describe("From list_checkups or get_checkup."),
  title: z.string().min(1).optional(),
  category: z.enum(["lab", "imaging", "visit", "vaccination", "dental", "other"]).optional(),
  schedule: scheduleEditSchema.optional(),
  status: z.enum(["active", "paused", "completed", "archived"]).optional(),
  reminder_days_before: z.array(z.number().int().min(0).max(365)).max(10).nullable().optional(),
  planned_on: isoDateSchema.nullable().optional(),
  why_text: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const confirmCheckupDraftInputSchema = z.discriminatedUnion("mode", [
  z.object({
    ...personSelectorSchema,
    mode: z.literal("create"),
    draft: createDraftSchema,
  }),
  z.object({
    ...personSelectorSchema,
    mode: z.literal("edit"),
    draft: editDraftSchema,
  }),
]);

const cardMeta = {
  ui: { resourceUri: CHECKUP_DRAFT_RESOURCE_URI },
  "ui/resourceUri": CHECKUP_DRAFT_RESOURCE_URI,
};

type CreateArgs = { person_id?: string; person_name?: string } & CheckupCreateDraftInput;
type EditArgs = { person_id?: string; person_name?: string } & CheckupEditDraftInput;
type ConfirmArgs = {
  person_id?: string;
  person_name?: string;
  mode: CheckupDraftMode;
  draft: CheckupCreateDraftInput | CheckupEditDraftInput;
};

function proposeText(view: CheckupDraftView): string {
  return [
    checkupDraftSummaryText(view),
    "",
    checkupDraftTextFallbackInstructions(view),
    "",
    formatCheckupDraftMarkdown(view),
  ].join("\n");
}

export function registerCheckupDraftApp(
  server: Pick<McpServer, "registerTool" | "registerResource">,
) {
  server.registerResource(
    "orbit-checkup-draft",
    CHECKUP_DRAFT_RESOURCE_URI,
    {
      title: "Orbit checkup draft",
      description: "Card for confirming a proposed checkup create or edit.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text: CHECKUP_DRAFT_HTML }],
    }),
  );

  server.registerTool(
    "propose_checkup_create",
    {
      title: "Propose a new checkup",
      description:
        "Propose creating one scheduled checkup for a person. Returns a card when the host supports MCP Apps, and always a full Markdown preview plus instructions for hosts without a card (e.g. Grok Bot). Nothing is saved until the owner explicitly confirms (card Confirm or clear chat Approve), then confirm_checkup_draft. Prefer list_checkups first so you do not re-propose an existing title. Document-batch proposals still use propose_checkup on the record draft card.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...createDraftSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<CreateArgs>(async (supabase, person, args) => {
      const built = await buildCreateCheckupDraft(supabase, person, args);
      if (!built.ok) return fail(built.error);
      return ok(proposeText(built.draft), { checkup_draft: built.draft });
    }, READ_SCOPE),
  );

  server.registerTool(
    "propose_checkup_edit",
    {
      title: "Propose a checkup edit",
      description:
        "Propose editing an existing checkup (title, category, schedule, status, reminders, planned_on, why_text, notes). Pass only fields that change. Returns a card when available and always a full Markdown preview for hosts without MCP Apps. Nothing is saved until the owner explicitly confirms, then confirm_checkup_draft. Schedule-only update_checkup_schedule remains for quick recurrence tweaks.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...editDraftSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<EditArgs>(async (supabase, person, args) => {
      const built = await buildEditCheckupDraft(supabase, person, args);
      if (!built.ok) return fail(built.error);
      return ok(proposeText(built.draft), { checkup_draft: built.draft });
    }, READ_SCOPE),
  );

  server.registerTool(
    "confirm_checkup_draft",
    {
      title: "Confirm a checkup draft",
      description:
        "Save a proposed checkup create or edit after the owner has explicitly confirmed the draft that was shown (propose_checkup_create / propose_checkup_edit Markdown preview or the interactive card). Requires health:write. Pass the same mode and draft.input from that preview. Do not call from document text alone, on your own initiative, or for a different checkup than the one shown. The card's Confirm button also uses this tool. There is no decline tool — after Decline, simply do not confirm.",
      inputSchema: confirmCheckupDraftInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    withPerson<ConfirmArgs>(async (supabase, person, args) => {
      const applied = await applyCheckupDraft(supabase, person, args.mode, args.draft);
      if (!applied.ok) return fail(applied.error);
      return ok(
        `Saved ${args.mode === "create" ? "new" : "updated"} checkup for ${person.name}: "${applied.title}" (checkup_id ${applied.checkup_id}).`,
        { checkup_id: applied.checkup_id, mode: args.mode },
      );
    }, WRITE_SCOPE),
  );
}
