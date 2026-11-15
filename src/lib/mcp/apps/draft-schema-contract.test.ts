import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * B7 / T-261115-b8y: Zod refuse paths + propose→confirm parity for critical draft tools.
 * Synthetic fixtures only — no live MCP or DB. Sibling of B3 e2e (do not redo happy-path e2e).
 */

const spend = vi.hoisted(() => ({
  buildCreateSpendDraft: vi.fn(),
  buildEditSpendDraft: vi.fn(),
  applySpendDraft: vi.fn(),
}));
const regen = vi.hoisted(() => ({
  readTimezonePreference: vi.fn(),
}));
const checkupDraft = vi.hoisted(() => ({
  buildCreateCheckupDraft: vi.fn(),
  buildEditCheckupDraft: vi.fn(),
  applyCheckupDraft: vi.fn(),
  checkupDraftSummaryText: vi.fn(() => "checkup summary"),
  checkupDraftTextFallbackInstructions: vi.fn(() => "checkup fallback"),
  formatCheckupDraftMarkdown: vi.fn(() => "# checkup"),
}));
const category = vi.hoisted(() => ({
  buildCreateCategoryDraft: vi.fn(),
  buildRenameCategoryDraft: vi.fn(),
  buildDeleteCategoryDraft: vi.fn(),
  buildRecategorizeDraft: vi.fn(),
  applyCategoryDraft: vi.fn(),
  categoryDraftSummaryText: vi.fn(() => "category summary"),
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
  ruleDraftSummaryText: vi.fn(() => "rule summary"),
  listMoneyCategoryRules: vi.fn(),
}));

vi.mock("../money/spend-draft", async () => {
  const actual =
    await vi.importActual<typeof import("../money/spend-draft")>("../money/spend-draft");
  return {
    ...actual,
    buildCreateSpendDraft: spend.buildCreateSpendDraft,
    buildEditSpendDraft: spend.buildEditSpendDraft,
    applySpendDraft: spend.applySpendDraft,
  };
});
vi.mock("@/lib/medications/regenerate-dose-events", () => ({
  readTimezonePreference: (...args: unknown[]) => regen.readTimezonePreference(...args),
}));
vi.mock("../health/checkup-draft", async () => {
  const actual =
    await vi.importActual<typeof import("../health/checkup-draft")>("../health/checkup-draft");
  return {
    ...actual,
    buildCreateCheckupDraft: checkupDraft.buildCreateCheckupDraft,
    buildEditCheckupDraft: checkupDraft.buildEditCheckupDraft,
    applyCheckupDraft: checkupDraft.applyCheckupDraft,
    checkupDraftSummaryText: checkupDraft.checkupDraftSummaryText,
    checkupDraftTextFallbackInstructions: checkupDraft.checkupDraftTextFallbackInstructions,
    formatCheckupDraftMarkdown: checkupDraft.formatCheckupDraftMarkdown,
  };
});
vi.mock("../money/category-draft", () => category);
vi.mock("../money/category-rules", () => rules);
vi.mock("../supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));
vi.mock("../resolve-person", () => ({
  resolvePerson: vi.fn(async () => ({
    status: "ok",
    person: { id: "11111111-1111-4111-8111-111111111111", name: "Seed", kind: "human" },
  })),
}));

import { confirmSpendDraftInputSchema, registerSpendDraftApp } from "./spend-draft";
import { confirmCheckupDraftInputSchema, registerCheckupDraftApp } from "./checkup-draft";
import { confirmCategoryDraftInputSchema, registerCategoryDraftApp } from "./category-draft";

type Handler = (
  args: unknown,
  ctx: unknown,
) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

type Registered = {
  config: { inputSchema?: z.ZodTypeAny; annotations?: { readOnlyHint?: boolean } };
  handler: Handler;
};

const PERSON = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATEGORY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TX = "22222222-2222-4222-8222-222222222222";
const CHECKUP = "33333333-3333-4333-8333-333333333333";
const LINE = "44444444-4444-4444-8444-444444444444";

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

const healthCtx = {
  http: {
    authInfo: {
      scopes: ["health:read", "health:write"],
      extra: moneyCtx.http.authInfo.extra,
    },
  },
};

const SPEND_CREATE = {
  account_id: ACCOUNT,
  posted_at: "2026-11-09T10:00:00.000Z",
  amount: -200,
  currency: "RUB",
  transaction_type: "expense" as const,
  merchant_name: "Кофейня Seed",
  comment: "synthetic",
  line_items: [
    {
      title: "Латте",
      amount: -200,
      category_id: CATEGORY,
      category_locked_by_user: true,
    },
  ],
};

const CHECKUP_CREATE = {
  title: "УЗИ щитовидной железы",
  category: "imaging" as const,
  schedule: { type: "interval" as const, every: 6, unit: "month" as const },
  first_due_at: "2026-12-01",
  why: "контроль",
};

const CATEGORY_CREATE = {
  name_en: "Bakery",
  name_ru: "Пекарня",
  canonical_category_id: ACCOUNT,
};

function registerAll() {
  const tools = new Map<string, Registered>();
  const server = {
    registerTool: vi.fn((name: string, config: Registered["config"], handler: Handler) => {
      tools.set(name, { config, handler });
      return {} as never;
    }),
    registerResource: vi.fn(() => ({}) as never),
  };
  registerSpendDraftApp(server as never);
  registerCheckupDraftApp(server as never);
  registerCategoryDraftApp(server as never);
  return tools;
}

function schema(tools: Map<string, Registered>, name: string): z.ZodTypeAny {
  const input = tools.get(name)?.config.inputSchema;
  expect(input, `${name} needs inputSchema`).toBeDefined();
  return input!;
}

function issuesContain(
  result: { success: true } | { success: false; error: { issues: unknown } },
  needle: string,
): void {
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(JSON.stringify(result.error.issues)).toContain(needle);
}

beforeEach(() => {
  vi.clearAllMocks();
  regen.readTimezonePreference.mockResolvedValue("Asia/Krasnoyarsk");

  spend.buildCreateSpendDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "create",
      person_id: PERSON,
      person_name: "Seed",
      transaction_id: null,
      account_label: "Cash",
      posted_at_label: "9 Nov",
      amount_label: "-200 RUB",
      type_label: "трата",
      merchant_name: SPEND_CREATE.merchant_name,
      comment: SPEND_CREATE.comment,
      lines: [{ title: "Латте", amount_label: "-200 RUB", category_label: "Еда" }],
      changes: [],
      input: SPEND_CREATE,
    },
  });
  spend.buildEditSpendDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "edit",
      person_id: PERSON,
      person_name: "Seed",
      transaction_id: TX,
      account_label: "Cash",
      posted_at_label: "9 Nov",
      amount_label: "-250 RUB",
      type_label: "трата",
      merchant_name: SPEND_CREATE.merchant_name,
      comment: "edit",
      lines: [{ title: "Латте", amount_label: "-250 RUB", category_label: "Еда" }],
      changes: ["сумма → -250 RUB"],
      input: {
        transaction_id: TX,
        account_id: ACCOUNT,
        posted_at: SPEND_CREATE.posted_at,
        amount: -250,
        currency: "RUB",
        transaction_type: "expense",
        merchant_name: SPEND_CREATE.merchant_name,
        comment: "edit",
        line_items: SPEND_CREATE.line_items,
      },
    },
  });
  spend.applySpendDraft.mockResolvedValue({
    ok: true,
    transaction_id: "tx-1",
    label: "Кофейня Seed",
  });

  checkupDraft.buildCreateCheckupDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "create",
      person_id: PERSON,
      person_name: "Seed",
      checkup_id: null,
      title: CHECKUP_CREATE.title,
      category_label: "Диагностика",
      schedule_label: "раз в 6 мес.",
      first_due_label: "1 Dec",
      status_label: "активен",
      planned_on_label: null,
      reminders_label: null,
      why: CHECKUP_CREATE.why,
      notes: null,
      condition_name: null,
      input: CHECKUP_CREATE,
    },
  });
  checkupDraft.buildEditCheckupDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "edit",
      person_id: PERSON,
      person_name: "Seed",
      checkup_id: CHECKUP,
      title: "УЗИ (правка)",
      category_label: "Диагностика",
      schedule_label: "раз в 6 мес.",
      first_due_label: "1 Dec",
      status_label: "активен",
      planned_on_label: null,
      reminders_label: null,
      why: CHECKUP_CREATE.why,
      notes: null,
      condition_name: null,
      input: { checkup_id: CHECKUP, title: "УЗИ (правка)" },
    },
  });
  checkupDraft.applyCheckupDraft.mockResolvedValue({
    ok: true,
    checkup_id: "c-1",
    title: CHECKUP_CREATE.title,
  });

  category.buildCreateCategoryDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "create",
      person_id: PERSON,
      person_name: "Seed",
      title: "Новая категория «Пекарня»",
      summary_lines: ["EN: Bakery"],
      input: CATEGORY_CREATE,
    },
  });
  category.applyCategoryDraft.mockResolvedValue({
    ok: true,
    id: "cat-1",
    label: "Пекарня",
  });
  rules.buildCreateRuleDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "rule_create",
      person_id: PERSON,
      person_name: "Seed",
      title: "Новое правило «Кофе»",
      summary_lines: ["direct"],
      input: {
        name: "Кофе",
        rule_kind: "direct",
        target_category_id: ACCOUNT,
      },
    },
  });
  rules.applyRuleDraft.mockResolvedValue({ ok: true, id: "r-1", label: "Кофе" });
});

describe("critical draft tools are registered with schemas", () => {
  it("covers spend, checkup, and category propose/confirm tools", () => {
    const tools = registerAll();
    expect([...tools.keys()].sort()).toEqual(
      [
        "confirm_category_draft",
        "confirm_checkup_draft",
        "confirm_spend_draft",
        "propose_category_create",
        "propose_category_delete",
        "propose_category_rename",
        "propose_category_rule_create",
        "propose_category_rule_delete",
        "propose_category_rule_update",
        "propose_category_rules_apply",
        "propose_checkup_create",
        "propose_checkup_edit",
        "propose_line_recategorize",
        "propose_spend",
        "propose_spend_edit",
      ].sort(),
    );
  });
});

describe("spend Zod refuse paths", () => {
  it("refuses invalid propose_spend input", () => {
    const propose = schema(registerAll(), "propose_spend");
    expect(propose.safeParse(SPEND_CREATE).success).toBe(true);
    issuesContain(propose.safeParse({ ...SPEND_CREATE, account_id: "not-a-uuid" }), "uuid");
    issuesContain(propose.safeParse({ ...SPEND_CREATE, amount: "-200" }), "number");
    issuesContain(
      propose.safeParse({ ...SPEND_CREATE, transaction_type: "tip" }),
      "transaction_type",
    );
  });

  it("refuses confirm mode/draft mismatches and bad fields", () => {
    const confirm = confirmSpendDraftInputSchema;
    expect(
      confirm.safeParse({ person_id: PERSON, mode: "create", draft: SPEND_CREATE }).success,
    ).toBe(true);

    // Edit mode without transaction_id — mismatched / incomplete draft.
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "edit",
        draft: { account_id: ACCOUNT, amount: -1 },
      }),
      "transaction_id",
    );

    // Create mode missing required account — invalid input.
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "create",
        draft: { posted_at: SPEND_CREATE.posted_at, amount: -1 },
      }),
      "account_id",
    );

    // Unknown discriminator.
    issuesContain(
      confirm.safeParse({ person_id: PERSON, mode: "update", draft: SPEND_CREATE }),
      "mode",
    );

    // Propose line cap still applies on create confirm.
    const tooMany = Array.from({ length: 41 }, (_, i) => ({
      title: `line-${i}`,
      amount: -1,
    }));
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "create",
        draft: { ...SPEND_CREATE, line_items: tooMany },
      }),
      "line_items",
    );

    // Edit confirm may preserve more lines than propose allows (parity with card round-trip).
    expect(
      confirm.safeParse({
        person_id: PERSON,
        mode: "edit",
        draft: {
          transaction_id: TX,
          line_items: tooMany,
        },
      }).success,
    ).toBe(true);
  });
});

describe("spend propose→confirm parity", () => {
  it("accepts confirm of the exact draft.input propose returned", async () => {
    const tools = registerAll();
    const proposed = await tools.get("propose_spend")!.handler(SPEND_CREATE, moneyCtx);
    expect(proposed.isError).toBeFalsy();
    const view = proposed.structuredContent?.spend_draft as {
      mode: "create";
      input: typeof SPEND_CREATE;
    };
    expect(view.mode).toBe("create");

    const parsed = confirmSpendDraftInputSchema.parse({
      person_id: PERSON,
      mode: view.mode,
      draft: view.input,
    });
    expect(parsed.mode).toBe("create");
    expect(parsed.draft).toMatchObject({
      account_id: ACCOUNT,
      amount: -200,
      merchant_name: "Кофейня Seed",
    });

    const editProposed = await tools
      .get("propose_spend_edit")!
      .handler({ person_id: PERSON, transaction_id: TX }, moneyCtx);
    const editView = editProposed.structuredContent?.spend_draft as {
      mode: "edit";
      input: Record<string, unknown>;
    };
    const editParsed = confirmSpendDraftInputSchema.parse({
      person_id: PERSON,
      mode: editView.mode,
      draft: editView.input,
    });
    expect(editParsed.mode).toBe("edit");
    expect(editParsed.draft).toMatchObject({ transaction_id: TX, amount: -250 });
  });

  it("surfaces stale apply refusal without writing a success", async () => {
    spend.applySpendDraft.mockResolvedValueOnce({
      ok: false,
      error: "Transaction 22222222-2222-4222-8222-222222222222 was not found",
    });
    const refused = await registerAll()
      .get("confirm_spend_draft")!
      .handler(
        {
          person_id: PERSON,
          mode: "edit",
          draft: { transaction_id: TX, amount: -250 },
        },
        moneyCtx,
      );
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("was not found");
  });
});

describe("checkup Zod refuse paths", () => {
  it("refuses invalid propose_checkup_create input", () => {
    const propose = schema(registerAll(), "propose_checkup_create");
    expect(propose.safeParse(CHECKUP_CREATE).success).toBe(true);
    issuesContain(propose.safeParse({ ...CHECKUP_CREATE, title: "" }), "title");
    issuesContain(propose.safeParse({ ...CHECKUP_CREATE, category: "mri" }), "category");
    issuesContain(
      propose.safeParse({
        ...CHECKUP_CREATE,
        schedule: { type: "interval", every: 0, unit: "month" },
      }),
      "every",
    );
    issuesContain(
      propose.safeParse({ ...CHECKUP_CREATE, first_due_at: "01-12-2026" }),
      "first_due_at",
    );
  });

  it("refuses confirm mode/draft mismatches", () => {
    const confirm = confirmCheckupDraftInputSchema;
    expect(
      confirm.safeParse({ person_id: PERSON, mode: "create", draft: CHECKUP_CREATE }).success,
    ).toBe(true);

    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "edit",
        draft: { title: "only title" },
      }),
      "checkup_id",
    );
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "create",
        draft: { title: "x", category: "lab", schedule: CHECKUP_CREATE.schedule },
      }),
      "why",
    );
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "create",
        draft: {
          ...CHECKUP_CREATE,
          schedule: { type: "one_off", due_at: "not-a-day" },
        },
      }),
      "due_at",
    );
  });
});

describe("checkup propose→confirm parity", () => {
  it("accepts confirm of the exact draft.input propose returned", async () => {
    const tools = registerAll();
    const proposed = await tools.get("propose_checkup_create")!.handler(CHECKUP_CREATE, healthCtx);
    const view = proposed.structuredContent?.checkup_draft as {
      mode: "create";
      input: typeof CHECKUP_CREATE;
    };
    const parsed = confirmCheckupDraftInputSchema.parse({
      person_id: PERSON,
      mode: view.mode,
      draft: view.input,
    });
    expect(parsed.draft).toMatchObject({
      title: CHECKUP_CREATE.title,
      why: CHECKUP_CREATE.why,
    });

    const editProposed = await tools
      .get("propose_checkup_edit")!
      .handler({ person_id: PERSON, checkup_id: CHECKUP, title: "УЗИ (правка)" }, healthCtx);
    const editView = editProposed.structuredContent?.checkup_draft as {
      mode: "edit";
      input: Record<string, unknown>;
    };
    expect(
      confirmCheckupDraftInputSchema.parse({
        person_id: PERSON,
        mode: editView.mode,
        draft: editView.input,
      }).draft,
    ).toMatchObject({ checkup_id: CHECKUP, title: "УЗИ (правка)" });
  });

  it("surfaces wrong-state apply refusal on confirm", async () => {
    checkupDraft.applyCheckupDraft.mockResolvedValueOnce({
      ok: false,
      error: "Checkup is archived; restore status before editing other fields",
    });
    const refused = await registerAll()
      .get("confirm_checkup_draft")!
      .handler(
        {
          person_id: PERSON,
          mode: "edit",
          draft: { checkup_id: CHECKUP, title: "x" },
        },
        healthCtx,
      );
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("archived");
  });
});

describe("category Zod refuse paths", () => {
  it("refuses invalid propose_category_create and rule_create input", () => {
    const tools = registerAll();
    const create = schema(tools, "propose_category_create");
    expect(create.safeParse(CATEGORY_CREATE).success).toBe(true);
    issuesContain(create.safeParse({ ...CATEGORY_CREATE, name_en: "" }), "name_en");
    issuesContain(create.safeParse({ ...CATEGORY_CREATE, canonical_category_id: "nope" }), "uuid");

    const rule = schema(tools, "propose_category_rule_create");
    issuesContain(
      rule.safeParse({
        name: "Кофе",
        rule_kind: "source_category_map",
        target_category_id: ACCOUNT,
      }),
      "rule_kind",
    );
    expect(
      rule.safeParse({
        name: "Кофе",
        rule_kind: "direct",
        target_category_id: ACCOUNT,
        force_overwrite_locked: false,
      }).success,
    ).toBe(true);
  });

  it("refuses confirm mode/draft mismatches across category and rule modes", () => {
    const confirm = confirmCategoryDraftInputSchema;
    expect(
      confirm.safeParse({ person_id: PERSON, mode: "create", draft: CATEGORY_CREATE }).success,
    ).toBe(true);

    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "rename",
        draft: { name_en: "Latte" },
      }),
      "category_id",
    );
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "delete",
        draft: { category_id: "bad" },
      }),
      "uuid",
    );
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "recategorize",
        draft: { line_item_id: LINE },
      }),
      "category_id",
    );
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "rule_update",
        draft: { name: "x" },
      }),
      "rule_id",
    );
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "rule_create",
        draft: { name: "Кофе", rule_kind: "direct", target_category_id: "bad" },
      }),
      "uuid",
    );
    issuesContain(
      confirm.safeParse({
        person_id: PERSON,
        mode: "archive",
        draft: CATEGORY_CREATE,
      }),
      "mode",
    );
  });
});

describe("category propose→confirm parity", () => {
  it("accepts confirm of propose_category_create and rule_create draft.input", async () => {
    const tools = registerAll();
    const proposed = await tools.get("propose_category_create")!.handler(CATEGORY_CREATE, moneyCtx);
    const view = proposed.structuredContent?.category_draft as {
      mode: "create";
      input: typeof CATEGORY_CREATE;
    };
    expect(
      confirmCategoryDraftInputSchema.parse({
        person_id: PERSON,
        mode: view.mode,
        draft: view.input,
      }).draft,
    ).toMatchObject(CATEGORY_CREATE);

    const ruleProposed = await tools.get("propose_category_rule_create")!.handler(
      {
        name: "Кофе",
        rule_kind: "direct",
        target_category_id: ACCOUNT,
      },
      moneyCtx,
    );
    const ruleView = ruleProposed.structuredContent?.category_draft as {
      mode: "rule_create";
      input: Record<string, unknown>;
    };
    expect(
      confirmCategoryDraftInputSchema.parse({
        person_id: PERSON,
        mode: ruleView.mode,
        draft: ruleView.input,
      }).mode,
    ).toBe("rule_create");
  });
});
