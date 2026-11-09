import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  applySpendDraft,
  buildCreateSpendDraft,
  buildEditSpendDraft,
  spendDraftSummaryText,
  type SpendCreateInput,
  type SpendEditInput,
  type SpendDraftMode,
} from "../money/spend-draft";
import { personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson } from "../tool-context";
import { fail, ok } from "../tool-result";
import { MONEY_READ_SCOPE, MONEY_WRITE_SCOPE } from "../tools/scopes";
import { MCP_APP_MIME_TYPE } from "./probe";
import { SPEND_DRAFT_HTML } from "./spend-draft-page";

/**
 * Manual spend create/edit as an MCP Apps card (T-261109-23p / stream D).
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
  line_items: z.array(lineItemSchema).max(40).optional(),
});

const editDraftSchema = z.object({
  transaction_id: uuidSchema,
  account_id: uuidSchema.optional(),
  posted_at: z.string().min(1).optional(),
  amount: z.number().optional(),
  currency: z.string().min(1).optional(),
  transaction_type: z.enum(TRANSACTION_TYPES).optional(),
  merchant_name: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  line_items: z.array(lineItemSchema).max(40).optional(),
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
    draft: editDraftSchema,
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
        "Propose creating a manual money transaction (spend/income) for a person, shown as a card the owner confirms from. Nothing is saved until they press Confirm on the card; end your turn and wait. Use list_money_accounts and list_money_categories for ids. There is no direct create-money tool — only this draft→confirm path.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...createDraftSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<CreateArgs>(async (supabase, person, args) => {
      const built = await buildCreateSpendDraft(supabase, person, args);
      if (!built.ok) return fail(built.error);
      return ok(spendDraftSummaryText(built.draft), { spend_draft: built.draft });
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "propose_spend_edit",
    {
      title: "Propose a spend edit",
      description:
        "Propose editing an existing money transaction, shown as a card the owner confirms from. Pass only the fields that change; omitted fields keep their current values. Nothing is saved until Confirm on the card. There is no direct update-money tool.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...editDraftSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<EditArgs>(async (supabase, person, args) => {
      const built = await buildEditSpendDraft(supabase, person, args);
      if (!built.ok) return fail(built.error);
      return ok(spendDraftSummaryText(built.draft), { spend_draft: built.draft });
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "confirm_spend_draft",
    {
      title: "Confirm a spend draft",
      description:
        "Used by the spend draft card's Confirm button (and after an explicit owner Approve in chat on hosts without MCP Apps): saves the proposed create or edit. Requires money:write. Call only after the owner clearly confirmed this same draft.",
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
