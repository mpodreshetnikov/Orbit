import { beforeEach, describe, expect, it, vi } from "vitest";

const accounts = vi.hoisted(() => ({
  listMoneyAccounts: vi.fn(),
  listMoneyCategories: vi.fn(),
}));

vi.mock("./transactions", async () => {
  const actual = await vi.importActual<typeof import("./transactions")>("./transactions");
  return {
    ...actual,
    listMoneyAccounts: accounts.listMoneyAccounts,
    listMoneyCategories: accounts.listMoneyCategories,
  };
});

import {
  applySpendDraft,
  buildCreateSpendDraft,
  buildEditSpendDraft,
  effectiveCategoryLock,
  formatMoneyAmount,
  spendDraftSummaryText,
} from "./spend-draft";

const PERSON = { id: "p-1", name: "Максим" };
const ACCOUNT = {
  id: "a-1",
  account_label: "Наличные",
  account_kind: "cash",
  currency: "RUB",
  source: "manual",
  is_active: true,
};

function createClient(handlers: {
  insertTx?:
    | { data: { id: string; merchant_name: string | null }; error: null }
    | { data: null; error: { message: string } };
  insertLines?: { error: null | { message: string } };
  existing?: Record<string, unknown> | null;
  existingError?: { message: string } | null;
  lines?: Array<Record<string, unknown>>;
  rpc?: { data: unknown; error: null | { message: string } };
}) {
  return {
    from(table: string) {
      if (table === "money_transactions") {
        return {
          insert() {
            return {
              select() {
                return {
                  single: async () =>
                    handlers.insertTx ?? {
                      data: { id: "tx-1", merchant_name: "Кофе" },
                      error: null,
                    },
                };
              },
            };
          },
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: handlers.existing === undefined ? null : handlers.existing,
                    error: handlers.existingError ?? null,
                  }),
                };
              },
            };
          },
        };
      }
      if (table === "money_line_items") {
        return {
          insert: async () => handlers.insertLines ?? { error: null },
          select() {
            return {
              eq: async () => ({ data: handlers.lines ?? [], error: null }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async () => handlers.rpc ?? { data: null, error: { message: "no rpc" } },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  accounts.listMoneyAccounts.mockResolvedValue([ACCOUNT]);
  accounts.listMoneyCategories.mockResolvedValue([
    {
      id: "c-food",
      parent_id: null,
      canonical_category_id: "c-food",
      category_kind: "expense",
      system_key: "food",
      name_en: "Food",
      name_ru: "Еда",
      archived_at: null,
    },
  ]);
});

describe("formatMoneyAmount", () => {
  it("keeps the sign the form uses", () => {
    expect(formatMoneyAmount(-1200, "RUB")).toBe("-1200.00 RUB");
    expect(formatMoneyAmount(50.5, "USD")).toBe("+50.50 USD");
  });
});

describe("buildCreateSpendDraft", () => {
  it("builds a card view without writing", async () => {
    const built = await buildCreateSpendDraft(createClient({}), PERSON, {
      account_id: "a-1",
      posted_at: "2026-11-09T10:00:00.000Z",
      amount: -350,
      currency: "RUB",
      transaction_type: "expense",
      merchant_name: "Кофейня",
      line_items: [{ title: "Латте", amount: -350, category_id: "c-food" }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.mode).toBe("create");
    expect(built.draft.account_label).toBe("Наличные");
    expect(built.draft.amount_label).toBe("-350.00 RUB");
    expect(built.draft.lines[0]?.category_label).toBe("Еда");
    expect(built.draft.changes).toEqual([]);
    // Manual category pick without an explicit lock flag must still serialize locked.
    expect(built.draft.input.line_items?.[0]?.category_locked_by_user).toBe(true);
    expect(spendDraftSummaryText(built.draft)).toContain("Кофейня");
    expect(spendDraftSummaryText(built.draft)).toMatch(/Markdown preview|text fallback/i);
    expect(spendDraftSummaryText(built.draft)).not.toMatch(/-350|350\.00/);
  });

  it("derives the same manual lock for apply and for draft serialization", () => {
    expect(effectiveCategoryLock({ title: "x", amount: -1, category_id: "c-1" })).toBe(true);
    expect(
      effectiveCategoryLock({
        title: "x",
        amount: -1,
        category_id: "c-1",
        assignment_method: "rule",
      }),
    ).toBe(false);
    expect(
      effectiveCategoryLock({
        title: "x",
        amount: -1,
        category_id: "c-1",
        category_locked_by_user: false,
      }),
    ).toBe(false);
  });

  it("refuses an unknown account", async () => {
    accounts.listMoneyAccounts.mockResolvedValue([]);
    const built = await buildCreateSpendDraft(createClient({}), PERSON, {
      account_id: "missing",
      posted_at: "2026-11-09T10:00:00.000Z",
      amount: -10,
      currency: "RUB",
      transaction_type: "expense",
    });
    expect(built.ok).toBe(false);
  });

  it("labels posted_at in Asia/Krasnoyarsk across the UTC day boundary (no DST)", async () => {
    // Seed: local 00:55 +07 is previous calendar day 17:55Z — label must stay on the 13th.
    const built = await buildCreateSpendDraft(
      createClient({}),
      PERSON,
      {
        account_id: "a-1",
        posted_at: "2026-11-13T00:55:00+07:00",
        amount: -120,
        currency: "RUB",
        transaction_type: "expense",
        merchant_name: "Seed Cafe",
      },
      { timeZone: "Asia/Krasnoyarsk" },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.posted_at_label).toMatch(/13 ноября 2026/);
    expect(built.draft.posted_at_label).toMatch(/00:55/);
    expect(built.draft.posted_at_label).not.toMatch(/12 ноября/);
    expect(built.draft.posted_at_label).not.toMatch(/17:55/);
    expect(built.draft.posted_at_label).not.toMatch(/UTC/i);
    // Storage instant stays UTC ISO; display-only fix.
    expect(built.draft.input.posted_at).toBe("2026-11-12T17:55:00.000Z");
  });

  it("falls back to UTC wall clock when no owner timezone is available", async () => {
    const built = await buildCreateSpendDraft(
      createClient({}),
      PERSON,
      {
        account_id: "a-1",
        posted_at: "2026-11-13T00:55:00+07:00",
        amount: -120,
        currency: "RUB",
        transaction_type: "expense",
      },
      { timeZone: null },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.posted_at_label).toMatch(/12 ноября 2026/);
    expect(built.draft.posted_at_label).toMatch(/17:55/);
    expect(built.draft.posted_at_label).not.toMatch(/UTC/i);
  });

  it("shows each provided line item in the preview, including a single position", async () => {
    const built = await buildCreateSpendDraft(createClient({}), PERSON, {
      account_id: "a-1",
      posted_at: "2026-11-09T10:00:00.000Z",
      amount: -350,
      currency: "RUB",
      transaction_type: "expense",
      merchant_name: "Кофейня",
      line_items: [{ title: "Латте", amount: -350, category_id: "c-food" }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.lines).toHaveLength(1);
    expect(built.draft.lines[0]).toMatchObject({
      title: "Латте",
      amount_label: "-350.00 RUB",
      category_label: "Еда",
    });
  });
});

describe("buildEditSpendDraft", () => {
  it("loads the existing transaction and keeps line ids for a header-only edit", async () => {
    const built = await buildEditSpendDraft(
      createClient({
        existing: {
          id: "tx-9",
          payer_person_id: "p-1",
          account_id: "a-1",
          posted_at: "2026-11-01T09:00:00.000Z",
          amount: -100,
          currency: "RUB",
          transaction_type: "expense",
          merchant_name: "Магазин",
          comment: null,
        },
        lines: [
          {
            id: "li-1",
            title: "Хлеб",
            amount: -100,
            quantity: 2,
            unit: "шт",
            line_status: "final",
            related_line_item_id: null,
            category_id: "c-food",
            beneficiary_person_id: null,
            assignment_method: "rule",
            assignment_rule_id: "rule-1",
            assignment_confidence: 0.9,
            category_locked_by_user: false,
            last_category_rule_id: "rule-1",
            last_category_rule_run_id: "run-1",
            category_assigned_at: "2026-11-01T09:00:00.000Z",
          },
        ],
      }),
      PERSON,
      { transaction_id: "tx-9", amount: -120, merchant_name: "Магазин у дома" },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.mode).toBe("edit");
    expect(built.draft.transaction_id).toBe("tx-9");
    expect(built.draft.merchant_name).toBe("Магазин у дома");
    expect(built.draft.amount_label).toBe("-120.00 RUB");
    expect(built.draft.input.line_items?.[0]).toMatchObject({
      id: "li-1",
      title: "Хлеб",
      quantity: 2,
      assignment_method: "rule",
      assignment_rule_id: "rule-1",
    });
    expect(built.draft.changes.some((line) => line.includes("сумма"))).toBe(true);
    expect(built.draft.changes.some((line) => line.includes("мерчант"))).toBe(true);
  });

  it("refuses another person's transaction", async () => {
    const built = await buildEditSpendDraft(
      createClient({
        existing: {
          id: "tx-9",
          payer_person_id: "p-other",
          account_id: "a-1",
          posted_at: "2026-11-01T09:00:00.000Z",
          amount: -100,
          currency: "RUB",
          transaction_type: "expense",
          merchant_name: "X",
          comment: null,
        },
      }),
      PERSON,
      { transaction_id: "tx-9" },
    );
    expect(built.ok).toBe(false);
  });
});

describe("applySpendDraft", () => {
  it("inserts a create draft", async () => {
    const applied = await applySpendDraft(
      createClient({
        insertTx: { data: { id: "tx-new", merchant_name: "Кофе" }, error: null },
        insertLines: { error: null },
      }),
      PERSON,
      "create",
      {
        account_id: "a-1",
        posted_at: "2026-11-09T10:00:00.000Z",
        amount: -80,
        currency: "RUB",
        transaction_type: "expense",
        merchant_name: "Кофе",
      },
    );
    expect(applied).toEqual({ ok: true, transaction_id: "tx-new", label: "Кофе" });
  });

  it("rolls back the header when line insert fails", async () => {
    const deletes: string[] = [];
    const applied = await applySpendDraft(
      {
        from(table: string) {
          if (table === "money_transactions") {
            return {
              insert() {
                return {
                  select() {
                    return {
                      single: async () => ({
                        data: { id: "tx-orphan", merchant_name: "Кофе" },
                        error: null,
                      }),
                    };
                  },
                };
              },
              delete() {
                return {
                  eq: async (_col: string, id: string) => {
                    deletes.push(id);
                    return { error: null };
                  },
                };
              },
            };
          }
          if (table === "money_line_items") {
            return {
              insert: async () => ({ error: { message: "category missing" } }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      } as never,
      PERSON,
      "create",
      {
        account_id: "a-1",
        posted_at: "2026-11-09T10:00:00.000Z",
        amount: -80,
        currency: "RUB",
        transaction_type: "expense",
        merchant_name: "Кофе",
        line_items: [{ title: "Латте", amount: -80, category_id: "c-food" }],
      },
    );
    expect(applied.ok).toBe(false);
    expect(deletes).toEqual(["tx-orphan"]);
  });

  it("updates via the atomic RPC on edit", async () => {
    const applied = await applySpendDraft(
      createClient({
        existing: {
          id: "tx-9",
          payer_person_id: "p-1",
          account_id: "a-1",
          posted_at: "2026-11-01T09:00:00.000Z",
          amount: -100,
          currency: "RUB",
          transaction_type: "expense",
          merchant_name: "Магазин",
          comment: null,
        },
        lines: [{ id: "li-1", title: "Хлеб", amount: -100, category_id: null }],
        rpc: {
          data: { transaction: { id: "tx-9", merchant_name: "Магазин" }, line_items: [] },
          error: null,
        },
      }),
      PERSON,
      "edit",
      { transaction_id: "tx-9", amount: -110 },
    );
    expect(applied).toEqual({ ok: true, transaction_id: "tx-9", label: "Магазин" });
  });
});
