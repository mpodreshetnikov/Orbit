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
    expect(spendDraftSummaryText(built.draft)).toContain("Кофейня");
    expect(spendDraftSummaryText(built.draft)).not.toMatch(/-350|350\.00/);
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
});

describe("buildEditSpendDraft", () => {
  it("loads the existing transaction for the person", async () => {
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
        lines: [{ id: "li-1", title: "Хлеб", amount: -100, category_id: "c-food" }],
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
