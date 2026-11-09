import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spend create/edit only via draft→confirm: propose writes nothing, confirm needs money:write.
 */
const spend = vi.hoisted(() => ({
  buildCreateSpendDraft: vi.fn(),
  buildEditSpendDraft: vi.fn(),
  applySpendDraft: vi.fn(),
  spendDraftSummaryText: vi.fn(
    (draft: { merchant_name: string | null }) =>
      `Showing a create spend draft for Максим on a card: "${draft.merchant_name}"`,
  ),
}));

vi.mock("../money/spend-draft", () => spend);
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
  registerSpendDraftApp,
  SPEND_DRAFT_RESOURCE_URI,
} from "./spend-draft";

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
  merchant_name: "Кофе",
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
  spend.buildCreateSpendDraft.mockResolvedValue({
    ok: true,
    draft: {
      mode: "create",
      person_id: "p-1",
      person_name: "Максим",
      transaction_id: null,
      account_label: "Наличные",
      posted_at_label: "9 ноября 2026 г., 10:00",
      amount_label: "-200.00 RUB",
      type_label: "трата",
      merchant_name: "Кофе",
      comment: null,
      lines: [],
      input: CREATE,
    },
  });
  spend.applySpendDraft.mockResolvedValue({
    ok: true,
    transaction_id: "tx-1",
    label: "Кофе",
  });
});

describe("registerSpendDraftApp", () => {
  it("links propose tools to the spend card and keeps confirm on the card/model", () => {
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
  });

  it("returns the card view and writes nothing on propose", async () => {
    const result = await register().tools.get("propose_spend")!.handler(CREATE, moneyCtx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Кофе");
    expect(result.structuredContent?.spend_draft).toMatchObject({ mode: "create" });
    expect(spend.applySpendDraft).not.toHaveBeenCalled();
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
