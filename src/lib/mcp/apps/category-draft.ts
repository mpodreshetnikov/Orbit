import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  applyCategoryDraft,
  buildCreateCategoryDraft,
  buildDeleteCategoryDraft,
  buildRecategorizeDraft,
  buildRenameCategoryDraft,
  categoryDraftSummaryText,
  type CategoryCreateInput,
  type CategoryDeleteInput,
  type CategoryDraftMode,
  type CategoryRenameInput,
  type LineRecategorizeInput,
} from "../money/category-draft";
import { personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson } from "../tool-context";
import { fail, ok } from "../tool-result";
import { MONEY_READ_SCOPE, MONEY_WRITE_SCOPE } from "../tools/scopes";
import { MCP_APP_MIME_TYPE } from "./probe";
import { CATEGORY_DRAFT_HTML } from "./category-draft-page";

/**
 * Category create/rename/delete + line recategorize as an MCP Apps card (T-261110-raf).
 *
 * Propose tools write nothing and need money:read. Confirm needs money:write — there is no
 * direct mutate category tool.
 */

export const CATEGORY_DRAFT_RESOURCE_URI = "ui://orbit/category-draft.html";

const createDraftSchema = z.object({
  name_en: z.string().min(1).describe("English name as shown in the tree."),
  name_ru: z.string().min(1).describe("Russian name as shown in the tree."),
  slug: z.string().min(1).optional().describe("Stable slug; derived from name_en when omitted."),
  canonical_category_id: uuidSchema.describe(
    "Built-in branch id from list_money_categories (category_kind=canonical).",
  ),
  parent_id: uuidSchema
    .nullable()
    .optional()
    .describe("Optional custom parent under the same canonical branch."),
});

const renameDraftSchema = z.object({
  category_id: uuidSchema.describe("Custom category id from list_money_categories."),
  name_en: z.string().min(1).optional(),
  name_ru: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  canonical_category_id: uuidSchema.optional(),
  parent_id: uuidSchema.nullable().optional(),
});

const deleteDraftSchema = z.object({
  category_id: uuidSchema.describe("Custom category id to delete (no children / usages)."),
});

const recategorizeDraftSchema = z.object({
  line_item_id: uuidSchema.describe("Line item id from list_money_transactions."),
  category_id: uuidSchema.nullable().describe("Target Orbit category id, or null to clear."),
});

export const confirmCategoryDraftInputSchema = z.discriminatedUnion("mode", [
  z.object({
    ...personSelectorSchema,
    mode: z.literal("create"),
    draft: createDraftSchema,
  }),
  z.object({
    ...personSelectorSchema,
    mode: z.literal("rename"),
    draft: renameDraftSchema,
  }),
  z.object({
    ...personSelectorSchema,
    mode: z.literal("delete"),
    draft: deleteDraftSchema,
  }),
  z.object({
    ...personSelectorSchema,
    mode: z.literal("recategorize"),
    draft: recategorizeDraftSchema,
  }),
]);

const cardMeta = {
  ui: { resourceUri: CATEGORY_DRAFT_RESOURCE_URI },
  "ui/resourceUri": CATEGORY_DRAFT_RESOURCE_URI,
};

type CreateArgs = { person_id?: string; person_name?: string } & CategoryCreateInput;
type RenameArgs = { person_id?: string; person_name?: string } & CategoryRenameInput;
type DeleteArgs = { person_id?: string; person_name?: string } & CategoryDeleteInput;
type RecatArgs = { person_id?: string; person_name?: string } & LineRecategorizeInput;
type ConfirmArgs = {
  person_id?: string;
  person_name?: string;
  mode: CategoryDraftMode;
  draft: CategoryCreateInput | CategoryRenameInput | CategoryDeleteInput | LineRecategorizeInput;
};

export function registerCategoryDraftApp(
  server: Pick<McpServer, "registerTool" | "registerResource">,
) {
  server.registerResource(
    "orbit-category-draft",
    CATEGORY_DRAFT_RESOURCE_URI,
    {
      title: "Orbit category draft",
      description: "Card for confirming a proposed money category change.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text: CATEGORY_DRAFT_HTML }],
    }),
  );

  server.registerTool(
    "propose_category_create",
    {
      title: "Propose a new money category",
      description:
        "Propose creating a custom money category under a canonical branch, shown as a card the owner confirms from. Nothing is saved until Confirm. Use list_money_categories for canonical_category_id / parent_id. There is no direct create-category tool.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...createDraftSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<CreateArgs>(async (supabase, person, args) => {
      const built = await buildCreateCategoryDraft(supabase, person, args);
      if (!built.ok) return fail(built.error);
      return ok(categoryDraftSummaryText(built.draft), { category_draft: built.draft });
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "propose_category_rename",
    {
      title: "Propose renaming a money category",
      description:
        "Propose renaming or moving a custom money category, shown as a card. Canonical categories cannot be renamed. Nothing is saved until Confirm.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...renameDraftSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<RenameArgs>(async (supabase, person, args) => {
      const built = await buildRenameCategoryDraft(supabase, person, args);
      if (!built.ok) return fail(built.error);
      return ok(categoryDraftSummaryText(built.draft), { category_draft: built.draft });
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "propose_category_delete",
    {
      title: "Propose deleting a money category",
      description:
        "Propose deleting a custom money category that has no children, line items, or rules targeting it. Canonical categories cannot be deleted. Nothing is deleted until Confirm.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...deleteDraftSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<DeleteArgs>(async (supabase, person, args) => {
      const built = await buildDeleteCategoryDraft(supabase, person, args);
      if (!built.ok) return fail(built.error);
      return ok(categoryDraftSummaryText(built.draft), { category_draft: built.draft });
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "propose_line_recategorize",
    {
      title: "Propose recategorizing a line item",
      description:
        "Propose setting the Orbit category on one receipt line (locks it so rules will not overwrite). Shown as a card; nothing is saved until Confirm. Use list_money_transactions for line_item_id and list_money_categories for category_id.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...recategorizeDraftSchema.shape,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: cardMeta,
    },
    withPerson<RecatArgs>(async (supabase, person, args) => {
      const built = await buildRecategorizeDraft(supabase, person, args);
      if (!built.ok) return fail(built.error);
      return ok(categoryDraftSummaryText(built.draft), { category_draft: built.draft });
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "confirm_category_draft",
    {
      title: "Confirm a category draft",
      description:
        "Used by the category draft card's Confirm button (and after an explicit owner Approve in chat on hosts without MCP Apps): applies create, rename, delete, or line recategorize. Requires money:write. Call only after the owner clearly confirmed this same draft.",
      inputSchema: confirmCategoryDraftInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    withPerson<ConfirmArgs>(async (supabase, person, args) => {
      const applied = await applyCategoryDraft(supabase, person, args.mode, args.draft);
      if (!applied.ok) return fail(applied.error);
      const verb =
        args.mode === "create"
          ? "Created"
          : args.mode === "rename"
            ? "Renamed"
            : args.mode === "delete"
              ? "Deleted"
              : "Recategorized";
      return ok(`${verb} «${applied.label}» (id ${applied.id}).`, {
        id: applied.id,
        mode: args.mode,
      });
    }, MONEY_WRITE_SCOPE),
  );
}
