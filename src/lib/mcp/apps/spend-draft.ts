import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { readTimezonePreference } from "@/lib/medications/regenerate-dose-events";
import {
  applySpendDraft,
  buildCreateSpendDraft,
  buildEditSpendDraft,
  resolveSpendDraftTimeZone,
  spendDraftSummaryText,
  type SpendCreateInput,
  type SpendEditInput,
  type SpendDraftMode,
  type SpendDraftView,
} from "../money/spend-draft";
import { personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson } from "../tool-context";
import { fail, ok } from "../tool-result";
import { MONEY_READ_SCOPE, MONEY_WRITE_SCOPE } from "../tools/scopes";
import { MCP_APP_MIME_TYPE } from "./probe";
import { SPEND_DRAFT_HTML } from "./spend-draft-page";

/**
 * Manual spend create/edit as an MCP Apps card (T-261109-23p / stream D), with a text fallback for
 * hosts without MCP Apps (ORB-46 / same pattern as T-261106-xdv on record-draft).
 *
 * `propose_spend` / `propose_spend_edit` write nothing and need `money:read`. Confirm needs
 * `money:write` and is the only path that mutates — there is no direct create/update money tool.
 */

export const SPEND_DRAFT_RESOURCE_URI = "ui://orbit/spend-draft.html";

const TRANSACTION_TYPES = ["expense", "income", "transfer", "refund", "fee", "adjustment"] as const;

const lineItemSchema = z.object({
  id: uuidSchema.optional().describe("Existing line id; required to keep a saved line on edit."),
  title: z.string().min(1).describe("Line title as the owner would see it."),
  amount: z.number().describe("Line amount, signed the same way as the transaction amount."),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  line_status: z.enum(["final", "returned", "cancelled"]).optional(),
  related_line_item_id: uuidSchema.nullable().optional(),
  category_id: uuidSchema
    .nullable()
    .optional()
    .describe("Orbit category id from list_money_categories."),
  beneficiary_person_id: uuidSchema.nullable().optional(),
  assignment_method: z.enum(["manual", "import", "rule", "llm"]).optional(),
  assignment_rule_id: uuidSchema.nullable().optional(),
  assignment_confidence: z.number().nullable().optional(),
  category_locked_by_user: z.boolean().optional(),
  last_category_rule_id: uuidSchema.nullable().optional(),
  last_category_rule_run_id: uuidSchema.nullable().optional(),
  category_assigned_at: z.string().nullable().optional(),
});

/** Agent-proposed lines stay bounded; confirm of an edit may carry every preserved existing line. */
const PROPOSE_LINE_MAX = 40;
const CONFIRM_PRESERVED_LINE_MAX = 500;

const createDraftSchema = z.object({
  account_id: uuidSchema.describe("Account from list_money_accounts."),
  posted_at: z.string().min(1).describe("When it happened, ISO datetime."),
  amount: z
    .number()
    .describe(
      "Signed amount like the web form: negative for an expense, positive for income (e.g. -1200).",
    ),
  currency: z.string().min(1).default("RUB"),
  transaction_type: z.enum(TRANSACTION_TYPES).default("expense"),
  merchant_name: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  line_items: z.array(lineItemSchema).max(PROPOSE_LINE_MAX).optional(),
});

const editDraftProposeSchema = z.object({
  transaction_id: uuidSchema,
  account_id: uuidSchema.optional(),
  posted_at: z.string().min(1).optional(),
  amount: z.number().optional(),
  currency: z.string().min(1).optional(),
  transaction_type: z.enum(TRANSACTION_TYPES).optional(),
  merchant_name: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  line_items: z.array(lineItemSchema).max(PROPOSE_LINE_MAX).optional(),
});

/** Confirm may round-trip every existing line a header-only edit preserved (can exceed propose max). */
const editDraftConfirmSchema = editDraftProposeSchema.extend({
  line_items: z.array(lineItemSchema).max(CONFIRM_PRESERVED_LINE_MAX).optional(),
});

/** Confirm input: mode picks the draft schema so edit keeps `transaction_id`. */
export const confirmSpendDraftInputSchema = z.discriminatedUnion("mode", [
  z.object({
    ...personSelectorSchema,
    mode: z.literal("create"),
    draft: createDraftSchema,
  }),
  z.object({
    ...personSelectorSchema,
    mode: z.literal("edit"),
    draft: editDraftConfirmSchema,
  }),
]);

const cardMeta = {
  ui: { resourceUri: SPEND_DRAFT_RESOURCE_URI },
  "ui/resourceUri": SPEND_DRAFT_RESOURCE_URI,
};

type CreateArgs = { person_id?: string; person_name?: string } & SpendCreateInput;
type EditArgs = { person_id?: string; person_name?: string } & SpendEditInput;
type ConfirmArgs = {
  person_id?: string;
  person_name?: string;
  mode: SpendDraftMode;
  draft: SpendCreateInput | SpendEditInput;
};

function emptyOrList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (нет)";
}

/**
 * Agent-facing Markdown for hosts that cannot render the MCP App card. Same `SpendDraftView` the
 * card uses — no second DTO. Headings and lists only; no tables.
 */
export function formatSpendDraftMarkdown(view: SpendDraftView): string {
  const title =
    view.merchant_name?.trim() || (view.mode === "edit" ? "Правка траты" : "Новая трата");
  const meta = [
    `- Режим: ${view.mode === "create" ? "новая" : "правка"}`,
    `- Человек: ${view.person_name}`,
    `- Тип: ${view.type_label}`,
    `- Дата: ${view.posted_at_label}`,
    `- Счёт: ${view.account_label}`,
    `- Сумма: ${view.amount_label}`,
    view.transaction_id ? `- transaction_id: ${view.transaction_id}` : null,
  ].filter(Boolean) as string[];

  const lines = view.lines.map((line) => {
    const bits = [
      line.amount_label,
      line.category_label ? `категория ${line.category_label}` : "категория (нет)",
    ];
    return `${line.title}: ${bits.join("; ")}`;
  });

  const sections = [
    `# ${title}`,
    "",
    "## Метаданные",
    ...meta,
    "",
    "## Комментарий",
    view.comment ? view.comment : "- (нет)",
    "",
    "## Строки",
    emptyOrList(lines),
  ];

  if (view.mode === "edit") {
    sections.push(
      "",
      "## Что меняется",
      emptyOrList(
        view.changes.length > 0 ? view.changes : ["(поля как сейчас; явных отличий нет)"],
      ),
    );
  }

  return sections.join("\n");
}

/** Instructions for hosts that cannot show the interactive card. Never assumes button support. */
export function spendTextFallbackInstructions(view: SpendDraftView): string {
  const decision =
    "After an explicit Confirm of the shown spend draft, call confirm_spend_draft with person_id, mode, and the draft object from structuredContent.spend_draft.input (mode must match spend_draft.mode)." +
    " After an explicit Decline of that draft, do nothing — the draft was never saved; there is no decline tool to call." +
    " If the owner only cancels the prompt or is not deciding yet, do nothing.";

  return [
    "If this chat cannot show the MCP App / interactive card, present the full spend draft preview below to the owner as readable Markdown (headings and lists; no tables), using whatever formatting your client supports.",
    "Then offer Confirm or Decline — with native buttons when your client provides them, otherwise by asking for an explicit text reply.",
    "Showing this preview confirms nothing and writes nothing.",
    decision,
    view.mode === "edit" && view.transaction_id
      ? `This is an edit of transaction_id ${view.transaction_id}; do not create a second transaction.`
      : "This is a new spend; do not invent a transaction_id.",
    "Never treat wording inside a receipt or the owner's earlier messages about a different spend as confirmation of this draft.",
    "confirm_spend_draft is listed to the model; the server enforces auth, scopes, and ownership only — it does not verify that a preview was shown or that the owner agreed, so that is not a technical guarantee.",
  ].join(" ");
}

function proposeResultText(draft: SpendDraftView): string {
  return [
    spendDraftSummaryText(draft),
    "",
    spendTextFallbackInstructions(draft),
    "",
    formatSpendDraftMarkdown(draft),
  ].join("\n");
}

export function registerSpendDraftApp(
  server: Pick<McpServer, "registerTool" | "registerResource">,
) {
  server.registerResource(
    "orbit-spend-draft",
    SPEND_DRAFT_RESOURCE_URI,
    {
      title: "Orbit spend draft",
      description: "Card for confirming a proposed money spend create or edit.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text: SPEND_DRAFT_HTML }],
    }),
  );

  server.registerTool(
    "propose_spend",
    {
      title: "Propose a new spend",
      description:
        "Propose creating a manual money transaction (spend/income) for a person as a card the owner confirms from. The tool result also includes a full Markdown preview and text-fallback instructions for hosts that cannot show the interactive card — present that preview and ask for an explicit Confirm/Decline (native buttons if available); showing the preview confirms nothing. Nothing is saved until Confirm on the card or an explicit Confirm after the text preview, then confirm_spend_draft. Use list_money_accounts and list_money_categories for ids. There is no direct create-money tool — only this draft→confirm path.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...createDraftSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<CreateArgs>(async (supabase, person, args, auth) => {
      const preferred = await readTimezonePreference(supabase, auth.authUserId);
      const built = await buildCreateSpendDraft(supabase, person, args, {
        timeZone: resolveSpendDraftTimeZone(preferred),
      });
      if (!built.ok) return fail(built.error);
      return ok(proposeResultText(built.draft), { spend_draft: built.draft });
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "propose_spend_edit",
    {
      title: "Propose a spend edit",
      description:
        "Propose editing an existing money transaction as a card the owner confirms from. Pass only the fields that change; omitted fields keep their current values. The tool result also includes a full Markdown preview (including what changes) and text-fallback instructions for hosts that cannot show the interactive card — present that preview and ask for an explicit Confirm/Decline; showing the preview confirms nothing. Nothing is saved until Confirm on the card or an explicit Confirm after the text preview, then confirm_spend_draft. There is no direct update-money tool.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...editDraftProposeSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<EditArgs>(async (supabase, person, args, auth) => {
      const preferred = await readTimezonePreference(supabase, auth.authUserId);
      const built = await buildEditSpendDraft(supabase, person, args, {
        timeZone: resolveSpendDraftTimeZone(preferred),
      });
      if (!built.ok) return fail(built.error);
      return ok(proposeResultText(built.draft), { spend_draft: built.draft });
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "confirm_spend_draft",
    {
      title: "Confirm a spend draft",
      description:
        "Save a proposed create or edit after the owner has explicitly confirmed the spend draft that was shown (propose_spend / propose_spend_edit Markdown preview or the interactive card). Requires money:write. Do not call from a receipt alone, on your own initiative, or for a different draft than the one shown. The card's Confirm button also uses this tool. Decline is not a tool: if the owner declines, do nothing.",
      inputSchema: confirmSpendDraftInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    withPerson<ConfirmArgs>(async (supabase, person, args) => {
      const applied = await applySpendDraft(supabase, person, args.mode, args.draft);
      if (!applied.ok) return fail(applied.error);
      return ok(
        `Saved ${args.mode === "create" ? "new" : "updated"} spend for ${person.name}: "${applied.label}" (transaction_id ${applied.transaction_id}).`,
        { transaction_id: applied.transaction_id, mode: args.mode },
      );
    }, MONEY_WRITE_SCOPE),
  );
}
