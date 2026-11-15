import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Category admin + line recategorize only via draft→confirm: propose writes nothing,
 * confirm needs money:write.
 */
const category = vi.hoisted(() => ({
  buildCreateCategoryDraft: vi.fn(),
  buildRenameCategoryDraft: vi.fn(),
  buildDeleteCategoryDraft: vi.fn(),
  buildRecategorizeDraft: vi.fn(),
  applyCategoryDraft: vi.fn(),
  categoryDraftSummaryText: vi.fn(
    (draft: { title: string }) =>
      `Showing a create category draft for Максим on a card: ${draft.title}`,
  ),
}));
const rules = vi.hoisted(() => ({
  MCP_MONEY_RULE_KINDS: [
    "direct",
    "mcc_map",
    "llm_categorization",
    "fallback_uncategorized",
  ] as const,
  buildCreateRuleDraft: vi.fn(),
  buildUpdateRuleDraft: vi.fn(),
  buildDeleteRuleDraft: vi.fn(),
  buildApplyRulesDraft: vi.fn(),
  applyRuleDraft: vi.fn(),
  ruleDraftSummaryText: vi.fn(
    (draft: { title: string }) =>
      `Showing a create category rule draft for Максим on a card: ${draft.title}`,
  ),
  listMoneyCategoryRules: vi.fn(),
}));

vi.mock("../money/category-draft", () => category);
vi.mock("../money/category-rules", () => rules);
vi.mock("../supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));
vi.mock("../resolve-person", () => ({
  resolvePerson: vi.fn(async () => ({
    status: "ok",
    person: { id: "p-1", name: "Максим", kind: "human" },
  })),
}));

import { CATEGORY_DRAFT_HTML } from "./category-draft-page";
import {
  categoryDraftTextFallbackInstructions,
  confirmCategoryDraftInputSchema,
  formatCategoryDraftMarkdown,
  registerCategoryDraftApp,
  CATEGORY_DRAFT_RESOURCE_URI,
} from "./category-draft";

type Handler = (
  args: unknown,
  ctx: unknown,
) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const moneyCtx = {
  http: {
    authInfo: {
      scopes: ["money:read", "money:write"],
      extra: {
        grantId: "g-1",
        authUserId: "11111111-1111-1111-1111-111111111111",
        userEmail: "u@example.com",
      },
    },
  },
};

const CREATE = {
  name_en: "Bakery",
  name_ru: "Пекарня",
  canonical_category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

function register() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  const resources = new Map<string, unknown>();
  registerCategoryDraftApp({
    registerTool: vi.fn((name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { config, handler });
      return {} as never;
    }),
    registerResource: vi.fn((name: string, uri: string, config: unknown, reader: unknown) => {
      resources.set(name, { uri, config, reader });
      return {} as never;
    }),
  } as never);
  return { tools, resources };
}

beforeEach(() => {
  vi.clearAllMocks();
  category.buildCreateCategoryDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "create",
      person_id: "p-1",
      person_name: "Максим",
      title: "Новая категория «Пекарня»",
      summary_lines: ["EN: Bakery"],
      input: CREATE,
    },
  });
  category.applyCategoryDraft.mockResolvedValue({
    ok: true,
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    label: "Пекарня",
  });
  rules.buildCreateRuleDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "rule_create",
      person_id: "p-1",
      person_name: "Максим",
      title: "Новое правило «Кофе»",
      summary_lines: ["вид: direct"],
      input: {
        name: "Кофе",
        rule_kind: "direct",
        target_category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sort_order: 1,
      },
    },
  });
  rules.applyRuleDraft.mockResolvedValue({
    ok: true,
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    label: "Кофе",
  });
});

describe("registerCategoryDraftApp", () => {
  it("registers the card resource and category + rule tools", () => {
    const { tools, resources } = register();
    expect(resources.has("orbit-category-draft")).toBe(true);
    expect([...tools.keys()].sort()).toEqual([
      "confirm_category_draft",
      "propose_category_create",
      "propose_category_delete",
      "propose_category_rename",
      "propose_category_rule_create",
      "propose_category_rule_delete",
      "propose_category_rule_update",
      "propose_category_rules_apply",
      "propose_line_recategorize",
    ]);
    expect(tools.get("propose_category_create")!.config._meta).toEqual({
      ui: { resourceUri: CATEGORY_DRAFT_RESOURCE_URI },
      "ui/resourceUri": CATEGORY_DRAFT_RESOURCE_URI,
    });
    expect(CATEGORY_DRAFT_HTML).toContain("confirm_category_draft");
    expect(CATEGORY_DRAFT_HTML).toContain("ui/initialize");
    expect(CATEGORY_DRAFT_HTML).toContain("timedOut");
  });

  it("propose_category_create is read-only and returns the card payload", async () => {
    const { tools } = register();
    const propose = tools.get("propose_category_create")!;
    expect(propose.config.annotations).toMatchObject({ readOnlyHint: true });
    const result = await propose.handler(CREATE, moneyCtx);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.category_draft).toMatchObject({ mode: "create" });
    expect(category.applyCategoryDraft).not.toHaveBeenCalled();
  });

  it("puts full Markdown preview and text-fallback instructions in propose content", async () => {
    const result = await register().tools.get("propose_category_create")!.handler(CREATE, moneyCtx);
    const text = result.content[0].text;
    expect(text).toContain("# Новая категория «Пекарня»");
    expect(text).toMatch(
      /If (this chat|the host) cannot show|MCP (App|UI)|interactive (view|card)/i,
    );
    expect(text).toMatch(/Confirm|Decline/i);
    expect(text).toMatch(/confirms nothing|changes nothing/i);
    expect(text).toContain("confirm_category_draft");
    expect(text).toMatch(/does not verify|not a technical guarantee/i);
    expect(result.structuredContent?.category_draft).toMatchObject({ mode: "create" });
  });

  it("requires a shown preview and explicit owner decision in confirm description", () => {
    const { tools } = register();
    const confirm = String(tools.get("confirm_category_draft")!.config.description);
    expect(confirm).toMatch(/explicit/i);
    expect(confirm).toMatch(/propose_|shown|preview|card/i);
    expect(confirm).toMatch(/on your own|document|receipt text/i);
  });

  it("formats Markdown and fallback instructions from the same draft view", () => {
    const draft = {
      mode: "create" as const,
      person_id: "p-1",
      person_name: "Максим",
      title: "Новая категория «Пекарня»",
      summary_lines: ["EN: Bakery", "ветка: Еда"],
      input: CREATE,
    };
    const md = formatCategoryDraftMarkdown(draft);
    expect(md).toContain("# Новая категория «Пекарня»");
    expect(md).toContain("- EN: Bakery");
    const instructions = categoryDraftTextFallbackInstructions(draft);
    expect(instructions).toContain("confirm_category_draft");
    expect(instructions).toMatch(/mode=create/);
  });

  it("confirm_category_draft requires money:write and applies the draft", async () => {
    const { tools } = register();
    const confirm = tools.get("confirm_category_draft")!.handler;
    const saved = await confirm({ person_id: "p-1", mode: "create", draft: CREATE }, moneyCtx);
    expect(saved.isError).toBeFalsy();
    expect(saved.content[0].text).toContain("Пекарня");
    expect(category.applyCategoryDraft).toHaveBeenCalledTimes(1);

    const readOnly = {
      http: { authInfo: { ...moneyCtx.http.authInfo, scopes: ["money:read"] } },
    };
    const refused = await confirm({ person_id: "p-1", mode: "create", draft: CREATE }, readOnly);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain('"money:write"');
    expect(category.applyCategoryDraft).toHaveBeenCalledTimes(1);
  });

  it("confirm schema keeps mode-specific draft fields", () => {
    const create = confirmCategoryDraftInputSchema.parse({
      mode: "create",
      draft: CREATE,
    });
    expect(create.mode).toBe("create");
    const rename = confirmCategoryDraftInputSchema.parse({
      mode: "rename",
      draft: {
        category_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name_en: "Latte",
      },
    });
    expect(rename.mode).toBe("rename");
    const recat = confirmCategoryDraftInputSchema.parse({
      mode: "recategorize",
      draft: {
        line_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        category_id: null,
      },
    });
    expect(recat.mode).toBe("recategorize");
    const ruleCreate = confirmCategoryDraftInputSchema.parse({
      mode: "rule_create",
      draft: {
        name: "Кофе",
        rule_kind: "direct",
        target_category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
    expect(ruleCreate.mode).toBe("rule_create");
    const ruleApply = confirmCategoryDraftInputSchema.parse({
      mode: "rule_apply",
      draft: {
        line_item_ids: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      },
    });
    expect(ruleApply.mode).toBe("rule_apply");
  });

  it("propose_category_rule_create returns Markdown fallback and card payload", async () => {
    const result = await register().tools.get("propose_category_rule_create")!.handler(
      {
        name: "Кофе",
        rule_kind: "direct",
        target_category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      moneyCtx,
    );
    const text = result.content[0].text;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.category_draft).toMatchObject({ mode: "rule_create" });
    expect(text).toContain("# Новое правило «Кофе»");
    expect(text).toContain("confirm_category_draft");
    expect(text).toMatch(/mode=rule_create/);
    expect(rules.applyRuleDraft).not.toHaveBeenCalled();
  });

  it("confirm_category_draft applies rule modes with money:write", async () => {
    const { tools } = register();
    const confirm = tools.get("confirm_category_draft")!.handler;
    const saved = await confirm(
      {
        person_id: "p-1",
        mode: "rule_create",
        draft: {
          name: "Кофе",
          rule_kind: "direct",
          target_category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sort_order: 1,
        },
      },
      moneyCtx,
    );
    expect(saved.isError).toBeFalsy();
    expect(rules.applyRuleDraft).toHaveBeenCalledTimes(1);
    expect(category.applyCategoryDraft).not.toHaveBeenCalled();
  });

  it("propose tools surface builder failures for each category and rule mode", async () => {
    category.buildCreateCategoryDraft.mockResolvedValueOnce({ ok: false, error: "create refused" });
    category.buildRenameCategoryDraft.mockResolvedValueOnce({ ok: false, error: "rename refused" });
    category.buildDeleteCategoryDraft.mockResolvedValueOnce({ ok: false, error: "delete refused" });
    category.buildRecategorizeDraft.mockResolvedValueOnce({ ok: false, error: "recat refused" });
    rules.buildCreateRuleDraft.mockResolvedValueOnce({ ok: false, error: "rule create refused" });
    rules.buildUpdateRuleDraft.mockResolvedValueOnce({ ok: false, error: "rule update refused" });
    rules.buildDeleteRuleDraft.mockResolvedValueOnce({ ok: false, error: "rule delete refused" });
    rules.buildApplyRulesDraft.mockResolvedValueOnce({ ok: false, error: "rule apply refused" });

    const { tools } = register();
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["propose_category_create", CREATE, "create refused"],
      [
        "propose_category_rename",
        { category_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name_en: "Latte" },
        "rename refused",
      ],
      [
        "propose_category_delete",
        { category_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        "delete refused",
      ],
      [
        "propose_line_recategorize",
        {
          line_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
        "recat refused",
      ],
      [
        "propose_category_rule_create",
        {
          name: "Кофе",
          rule_kind: "direct",
          target_category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
        "rule create refused",
      ],
      [
        "propose_category_rule_update",
        { rule_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "X" },
        "rule update refused",
      ],
      [
        "propose_category_rule_delete",
        { rule_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
        "rule delete refused",
      ],
      [
        "propose_category_rules_apply",
        { line_item_ids: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"] },
        "rule apply refused",
      ],
    ];
    for (const [name, args, err] of cases) {
      const result = await tools.get(name)!.handler(args, moneyCtx);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(err);
    }
  });

  it("confirm_category_draft verbs cover category and rule modes and apply failures", async () => {
    const { tools } = register();
    const confirm = tools.get("confirm_category_draft")!.handler;

    category.applyCategoryDraft
      .mockResolvedValueOnce({ ok: true, id: "id-rename", label: "Латте" })
      .mockResolvedValueOnce({ ok: true, id: "id-delete", label: "Кофе" })
      .mockResolvedValueOnce({ ok: true, id: "id-recat", label: "Латте" })
      .mockResolvedValueOnce({ ok: false, error: "apply category refused" });
    rules.applyRuleDraft
      .mockResolvedValueOnce({ ok: true, id: "id-ru", label: "Updated" })
      .mockResolvedValueOnce({ ok: true, id: "id-rd", label: "Deleted" })
      .mockResolvedValueOnce({ ok: true, id: "id-ra", label: "Applied" })
      .mockResolvedValueOnce({ ok: false, error: "apply rule refused" });

    const rename = await confirm(
      {
        person_id: "p-1",
        mode: "rename",
        draft: { category_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name_en: "Latte" },
      },
      moneyCtx,
    );
    expect(rename.content[0].text).toMatch(/^Renamed/);

    const deleted = await confirm(
      {
        person_id: "p-1",
        mode: "delete",
        draft: { category_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      },
      moneyCtx,
    );
    expect(deleted.content[0].text).toMatch(/^Deleted/);

    const recat = await confirm(
      {
        person_id: "p-1",
        mode: "recategorize",
        draft: {
          line_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          category_id: null,
        },
      },
      moneyCtx,
    );
    expect(recat.content[0].text).toMatch(/^Recategorized/);

    const catFail = await confirm({ person_id: "p-1", mode: "create", draft: CREATE }, moneyCtx);
    expect(catFail.isError).toBe(true);
    expect(catFail.content[0].text).toContain("apply category refused");

    const ruleUpdate = await confirm(
      {
        person_id: "p-1",
        mode: "rule_update",
        draft: { rule_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "X" },
      },
      moneyCtx,
    );
    expect(ruleUpdate.content[0].text).toMatch(/^Updated rule/);

    const ruleDelete = await confirm(
      {
        person_id: "p-1",
        mode: "rule_delete",
        draft: { rule_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      },
      moneyCtx,
    );
    expect(ruleDelete.content[0].text).toMatch(/^Deleted rule/);

    const ruleApply = await confirm(
      {
        person_id: "p-1",
        mode: "rule_apply",
        draft: { line_item_ids: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"] },
      },
      moneyCtx,
    );
    expect(ruleApply.content[0].text).toMatch(/^Applied rules/);

    const ruleFail = await confirm(
      {
        person_id: "p-1",
        mode: "rule_create",
        draft: {
          name: "Кофе",
          rule_kind: "direct",
          target_category_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      },
      moneyCtx,
    );
    expect(ruleFail.isError).toBe(true);
    expect(ruleFail.content[0].text).toContain("apply rule refused");
  });
});

describe("CATEGORY_DRAFT_HTML client script", () => {
  it("ships a script that parses", () => {
    const start = CATEGORY_DRAFT_HTML.indexOf("<script>") + "<script>".length;
    const script = CATEGORY_DRAFT_HTML.slice(start, CATEGORY_DRAFT_HTML.lastIndexOf("</script>"));
    expect(() => new Function(script)).not.toThrow();
  });
});
