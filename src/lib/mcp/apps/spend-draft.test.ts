import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spend create/edit only via draft→confirm: propose writes nothing, confirm needs money:write.
 * Markdown + text-fallback must work on hosts without MCP Apps (ORB-46 / #245 pattern).
 */
const spend = vi.hoisted(() => ({
  buildCreateSpendDraft: vi.fn(),
  buildEditSpendDraft: vi.fn(),
  applySpendDraft: vi.fn(),
}));
const regen = vi.hoisted(() => ({
  readTimezonePreference: vi.fn(),
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
vi.mock("../supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));
vi.mock("../resolve-person", () => ({
  resolvePerson: vi.fn(async () => ({
    status: "ok",
    person: { id: "p-1", name: "Максим", kind: "human" },
  })),
}));

import { SPEND_DRAFT_HTML } from "./spend-draft-page";
import {
  confirmSpendDraftInputSchema,
  formatSpendDraftMarkdown,
  registerSpendDraftApp,
  spendTextFallbackInstructions,
  SPEND_DRAFT_RESOURCE_URI,
} from "./spend-draft";
import type { SpendDraftView } from "../money/spend-draft";

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
  account_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  posted_at: "2026-11-09T10:00:00.000Z",
  amount: -200,
  currency: "RUB",
  transaction_type: "expense" as const,
  merchant_name: "Кофейня Seed",
  comment: "synthetic seed",
  line_items: [
    {
      title: "Латте",
      amount: -200,
      category_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      category_locked_by_user: true,
    },
  ],
};

const CREATE_DRAFT: SpendDraftView = {
  mode: "create",
  person_id: "p-1",
  person_name: "Seed Person",
  transaction_id: null,
  account_label: "Наличные Seed",
  posted_at_label: "9 ноября 2026 г., 10:00",
  amount_label: "-200.00 RUB",
  type_label: "трата",
  merchant_name: "Кофейня Seed",
  comment: "synthetic seed",
  lines: [{ title: "Латте", amount_label: "-200.00 RUB", category_label: "Еда" }],
  changes: [],
  input: CREATE,
};

const EDIT_DRAFT: SpendDraftView = {
  mode: "edit",
  person_id: "p-1",
  person_name: "Seed Person",
  transaction_id: "22222222-2222-4222-8222-222222222222",
  account_label: "Наличные Seed",
  posted_at_label: "9 ноября 2026 г., 10:00",
  amount_label: "-250.00 RUB",
  type_label: "трата",
  merchant_name: "Кофейня Seed",
  comment: "правка комментария",
  lines: [{ title: "Латте", amount_label: "-250.00 RUB", category_label: "Еда" }],
  changes: ["сумма → -250.00 RUB", "комментарий → правка комментария"],
  input: {
    transaction_id: "22222222-2222-4222-8222-222222222222",
    account_id: CREATE.account_id,
    posted_at: CREATE.posted_at,
    amount: -250,
    currency: "RUB",
    transaction_type: "expense",
    merchant_name: "Кофейня Seed",
    comment: "правка комментария",
    line_items: CREATE.line_items,
  },
};

function register() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  const resources = new Map<string, unknown>();
  registerSpendDraftApp({
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
  regen.readTimezonePreference.mockResolvedValue("Asia/Krasnoyarsk");
  spend.buildCreateSpendDraft.mockResolvedValue({ ok: true, draft: CREATE_DRAFT });
  spend.buildEditSpendDraft.mockResolvedValue({ ok: true, draft: EDIT_DRAFT });
  spend.applySpendDraft.mockResolvedValue({
    ok: true,
    transaction_id: "tx-1",
    label: "Кофейня Seed",
  });
});

describe("formatSpendDraftMarkdown", () => {
  it("renders a create draft as readable Markdown lists without tables", () => {
    const md = formatSpendDraftMarkdown(CREATE_DRAFT);
    expect(md).toContain("# Кофейня Seed");
    expect(md).toContain("Режим: новая");
    expect(md).toContain("Seed Person");
    expect(md).toContain("трата");
    expect(md).toContain("Наличные Seed");
    expect(md).toContain("-200.00 RUB");
    expect(md).toContain("synthetic seed");
    expect(md).toMatch(/## Строки/);
    expect(md).toContain("Латте");
    expect(md).toContain("Еда");
    expect(md).not.toMatch(/## Что меняется/);
    expect(md).not.toMatch(/\|[-:]+\|/);
    expect(md).not.toMatch(/^\|.+\|$/m);
  });

  it("renders an edit draft with the change list", () => {
    const md = formatSpendDraftMarkdown(EDIT_DRAFT);
    expect(md).toContain("Режим: правка");
    expect(md).toContain("transaction_id: 22222222-2222-4222-8222-222222222222");
    expect(md).toMatch(/## Что меняется/);
    expect(md).toContain("сумма → -250.00 RUB");
    expect(md).toContain("комментарий → правка комментария");
  });
});

describe("registerSpendDraftApp", () => {
  it("links propose tools to the spend card and keeps confirm model-callable", () => {
    const { tools, resources } = register();
    expect(resources.get("orbit-spend-draft")).toMatchObject({
      uri: SPEND_DRAFT_RESOURCE_URI,
    });
    expect(tools.get("propose_spend")!.config._meta).toEqual({
      ui: { resourceUri: SPEND_DRAFT_RESOURCE_URI },
      "ui/resourceUri": SPEND_DRAFT_RESOURCE_URI,
    });
    expect(tools.get("propose_spend")!.config.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.get("propose_spend_edit")!.config.annotations).toMatchObject({
      readOnlyHint: true,
    });
    expect(tools.get("confirm_spend_draft")!.config.annotations).toMatchObject({
      readOnlyHint: false,
    });
    expect(tools.get("confirm_spend_draft")!.config._meta).toEqual({
      ui: { visibility: ["model", "app"] },
    });
    const confirm = String(tools.get("confirm_spend_draft")!.config.description);
    expect(confirm).toMatch(/explicitly confirmed|explicit Confirm/i);
    expect(confirm).toMatch(/Decline is not a tool|do nothing/i);
  });

  it("returns Markdown preview + text-fallback and writes nothing on propose", async () => {
    const result = await register().tools.get("propose_spend")!.handler(CREATE, moneyCtx);
    expect(result.isError).toBeFalsy();
    expect(spend.buildCreateSpendDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "p-1" }),
      expect.objectContaining({ account_id: CREATE.account_id }),
      { timeZone: "Asia/Krasnoyarsk" },
    );
    const text = result.content[0].text;
    expect(text).toContain("Кофейня Seed");
    expect(text).toContain("# Кофейня Seed");
    expect(text).toContain("Латте");
    expect(text).toMatch(
      /If (this chat|the host) cannot show|MCP (App|UI)|interactive (view|card)/i,
    );
    expect(text).toMatch(/Confirm|Decline/i);
    expect(text).toMatch(/confirms nothing|writes nothing/i);
    expect(text).toContain("confirm_spend_draft");
    expect(text).toMatch(/no decline tool|do nothing/i);
    expect(result.structuredContent?.spend_draft).toMatchObject({ mode: "create" });
    expect(spend.applySpendDraft).not.toHaveBeenCalled();
  });

  it("includes edit changes in propose_spend_edit text", async () => {
    const result = await register()
      .tools.get("propose_spend_edit")!
      .handler({ person_id: "p-1", transaction_id: EDIT_DRAFT.transaction_id }, moneyCtx);
    const text = result.content[0].text;
    expect(text).toContain("Что меняется");
    expect(text).toContain("сумма → -250.00 RUB");
    expect(text).toContain("confirm_spend_draft");
    expect(spendTextFallbackInstructions(EDIT_DRAFT)).toContain(EDIT_DRAFT.transaction_id!);
  });

  it("needs money:read to propose", async () => {
    const healthOnly = {
      http: { authInfo: { ...moneyCtx.http.authInfo, scopes: ["health:read", "health:write"] } },
    };
    const result = await register().tools.get("propose_spend")!.handler(CREATE, healthOnly);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"money:read"');
    expect(spend.buildCreateSpendDraft).not.toHaveBeenCalled();
  });

  it("confirms with money:write and denies without it", async () => {
    const confirm = register().tools.get("confirm_spend_draft")!.handler;
    const saved = await confirm({ person_id: "p-1", mode: "create", draft: CREATE }, moneyCtx);
    expect(saved.isError).toBeFalsy();
    expect(saved.content[0].text).toContain("transaction_id tx-1");
    expect(spend.applySpendDraft).toHaveBeenCalledTimes(1);

    const readOnly = {
      http: { authInfo: { ...moneyCtx.http.authInfo, scopes: ["money:read"] } },
    };
    const refused = await confirm({ person_id: "p-1", mode: "create", draft: CREATE }, readOnly);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain('"money:write"');
    expect(spend.applySpendDraft).toHaveBeenCalledTimes(1);
  });
});

describe("confirmSpendDraftInputSchema", () => {
  const editBase = {
    person_id: "11111111-1111-4111-8111-111111111111",
    mode: "edit" as const,
    draft: {
      transaction_id: "22222222-2222-4222-8222-222222222222",
      account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      posted_at: "2026-11-09T10:00:00.000Z",
      amount: -200,
      currency: "RUB",
      transaction_type: "expense" as const,
      merchant_name: "Кофе",
      line_items: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Латте",
          amount: -200,
          assignment_method: "rule" as const,
        },
      ],
    },
  };

  it("keeps transaction_id on edit drafts instead of stripping via create schema", () => {
    const parsed = confirmSpendDraftInputSchema.parse(editBase);
    expect(parsed.mode).toBe("edit");
    expect(parsed.draft).toMatchObject({
      transaction_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed.draft.line_items?.[0]).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      assignment_method: "rule",
    });
  });

  it("accepts an edit confirm that preserves more than the propose line cap", () => {
    const many = Array.from({ length: 41 }, (_, i) => ({
      id: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`,
      title: `line-${i}`,
      amount: -1,
    }));
    const parsed = confirmSpendDraftInputSchema.parse({
      ...editBase,
      draft: { ...editBase.draft, line_items: many },
    });
    expect(parsed.draft.line_items).toHaveLength(41);
  });
});

describe("the spend card", () => {
  it("confirms through confirm_spend_draft with the draft it was given", () => {
    expect(SPEND_DRAFT_HTML).toContain('name: "confirm_spend_draft"');
    expect(SPEND_DRAFT_HTML).toContain("draft.input");
    expect(SPEND_DRAFT_HTML).toContain("Подтвердить");
    expect(SPEND_DRAFT_HTML).toContain('protocolVersion: "2026-01-26"');
    expect(SPEND_DRAFT_HTML).toContain("ui/notifications/initialized");
  });

  it("keeps confirm in-flight after a timeout but surfaces definitive RPC rejects", () => {
    expect(SPEND_DRAFT_HTML).toContain("timedOut.timedOut = true");
    expect(SPEND_DRAFT_HTML).toContain("if (err && err.timedOut)");
    expect(SPEND_DRAFT_HTML).toContain('kind: "waiting"');
    expect(SPEND_DRAFT_HTML).toContain("late.error");
  });
});

describe("SPEND_DRAFT_HTML client script", () => {
  it("ships a script that parses", () => {
    const start = SPEND_DRAFT_HTML.indexOf("<script>") + "<script>".length;
    const script = SPEND_DRAFT_HTML.slice(start, SPEND_DRAFT_HTML.lastIndexOf("</script>"));
    expect(() => new Function(script)).not.toThrow();
  });
});
