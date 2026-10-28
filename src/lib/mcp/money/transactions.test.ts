import { describe, expect, it } from "vitest";
import { createSupabaseStub } from "../health/test-support";
import {
  listMoneyAccounts,
  listMoneyCategories,
  listMoneyTransactions,
  resolveCategoryFilter,
  type MoneyCategory,
} from "./transactions";

function category(overrides: Partial<MoneyCategory> & { id: string }): MoneyCategory {
  return {
    parent_id: null,
    canonical_category_id: overrides.id,
    category_kind: "canonical",
    system_key: null,
    name_en: overrides.id,
    name_ru: overrides.id,
    archived_at: null,
    ...overrides,
  };
}

const categories: MoneyCategory[] = [
  category({ id: "food", system_key: "food", name_en: "Food", name_ru: "Еда" }),
  category({
    id: "cafes",
    parent_id: "food",
    canonical_category_id: "food",
    category_kind: "custom",
    name_en: "Cafes",
    name_ru: "Кафе",
  }),
  category({
    id: "coffee",
    parent_id: "cafes",
    canonical_category_id: "food",
    category_kind: "custom",
    name_en: "Coffee",
    name_ru: "Кофе",
  }),
  category({
    id: "transport",
    system_key: "transport",
    name_en: "Transport",
    name_ru: "Транспорт",
  }),
];

describe("resolveCategoryFilter", () => {
  it("expands a canonical key to the subcategories filed under it", () => {
    expect(resolveCategoryFilter(categories, ["food"]).ids.sort()).toEqual(
      ["cafes", "coffee", "food"].sort(),
    );
  });

  it("matches names in either language and ids, and reports what matched nothing", () => {
    const resolved = resolveCategoryFilter(categories, ["кафе", "transport", "nope"]);
    expect(resolved.ids.sort()).toEqual(["cafes", "coffee", "transport"].sort());
    expect(resolved.unknown).toEqual(["nope"]);
  });
});

const feedRow = {
  id: "t-1",
  payer_person_id: "p-1",
  account_id: "a-1",
  account_label: "Tinkoff Black",
  account_kind: "debit",
  card_id: "c-1",
  card_last4: "1778",
  card_label: "Основная",
  money_cards: null,
  source: "tbank",
  external_id: "op-1",
  posted_at: "2026-10-27T18:30:00Z",
  created_at: "2026-10-27T18:31:00Z",
  amount: -1290,
  currency: "RUB",
  transaction_type: "expense",
  status: "posted",
  merchant_name: "VKUSVILL",
  comment: null,
  source_comment: null,
  is_transfer: false,
  transfer_group_id: null,
  brand_id: null,
  operation_icon_url: null,
  cashback_amount: 12.9,
  cashback_currency: "RUB",
  source_category_id: "supermarkets",
  source_category_name: "Супермаркеты",
  receipt_enrichment_status: "ok",
  receipt_request_key: null,
  raw_payload: { operation: { mcc: "5411", merchant: { name: "ВкусВилл" } } },
  line_items: [
    { title: "Кофе зерновой", amount: -890, quantity: 1, unit: "шт", category_id: "coffee" },
    { title: "Молоко", amount: -400, quantity: 2, unit: "шт", category_id: null },
  ],
  line_item_titles: ["Кофе зерновой", "Молоко"],
  line_item_count: 2,
  category_ids: ["coffee"],
  total_count: 37,
};

describe("listMoneyTransactions", () => {
  it("passes the filters to the web feed's RPC and caps the page size", async () => {
    const stub = createSupabaseStub({}, { money_list_transactions_feed: { data: [] } });

    await listMoneyTransactions(
      stub.client,
      {
        payerPersonId: "p-1",
        search: "  кофе ",
        categoryIds: ["food", "cafes"],
        transfers: "exclude",
        amountSign: "expense",
        fromUtc: "2026-10-01T00:00:00.000Z",
        offset: 50,
        limit: 500,
      },
      categories,
    );

    expect(stub.rpc).toHaveBeenCalledWith(
      "money_list_transactions_feed",
      expect.objectContaining({
        p_payer_person_id: "p-1",
        p_search: "кофе",
        p_category_ids: ["food", "cafes"],
        p_transfer_filter: "exclude",
        p_amount_sign: "expense",
        p_from: "2026-10-01T00:00:00.000Z",
        p_offset: 50,
        p_limit: 200,
      }),
    );
  });

  it("returns bank, counterparty and line items with their canonical category, and no card number", async () => {
    const stub = createSupabaseStub({}, { money_list_transactions_feed: { data: [feedRow] } });

    const page = await listMoneyTransactions(
      stub.client,
      { payerPersonId: "p-1", offset: 0, limit: 50 },
      categories,
    );

    expect(page.total).toBe(37);
    const [transaction] = page.transactions;
    expect(transaction).toMatchObject({
      bank: "T-Bank",
      account: { id: "a-1", label: "Tinkoff Black", kind: "debit" },
      card_label: "Основная",
      counterparty: { direction: "to", name: "ВкусВилл" },
      mcc: "5411",
      bank_category: "Супермаркеты",
      cashback: { amount: 12.9, currency: "RUB" },
    });
    expect(transaction.line_items).toEqual([
      expect.objectContaining({
        title: "Кофе зерновой",
        amount: -890,
        category: { id: "coffee", name: "Кофе", canonical_key: "food" },
      }),
      expect.objectContaining({ title: "Молоко", category: null }),
    ]);
    expect(transaction).not.toHaveProperty("bank_operation");
    expect(JSON.stringify(transaction)).not.toContain("1778");
  });

  it("adds the sanitized bank operation only when asked", async () => {
    const stub = createSupabaseStub({}, { money_list_transactions_feed: { data: [feedRow] } });

    const page = await listMoneyTransactions(
      stub.client,
      { payerPersonId: "p-1", offset: 0, limit: 50 },
      categories,
      true,
    );

    expect(page.transactions[0].bank_operation).toEqual({
      mcc: "5411",
      merchant: { name: "ВкусВилл" },
    });
  });

  it("surfaces an RPC error", async () => {
    const stub = createSupabaseStub(
      {},
      { money_list_transactions_feed: { error: { message: "permission denied" } } },
    );
    await expect(
      listMoneyTransactions(stub.client, { payerPersonId: "p-1", offset: 0, limit: 5 }, []),
    ).rejects.toThrow("permission denied");
  });
});

describe("listMoneyCategories and listMoneyAccounts", () => {
  it("reads every category the caller can see, roots first", async () => {
    const stub = createSupabaseStub({ money_categories: [{ data: categories }] });

    expect(await listMoneyCategories(stub.client)).toEqual(categories);
    expect(stub.argsFor("money_categories", "order")[0]).toEqual(["depth", { ascending: true }]);
  });

  it("reads one owner's accounts without their external numbers", async () => {
    const stub = createSupabaseStub({ money_accounts: [{ data: [{ id: "a-1" }] }] });

    expect(await listMoneyAccounts(stub.client, "p-1")).toEqual([{ id: "a-1" }]);
    expect(stub.argsFor("money_accounts", "eq")[0]).toEqual(["owner_person_id", "p-1"]);
    expect(String(stub.argsFor("money_accounts", "select")[0][0])).not.toContain("external");
  });

  it("surfaces read errors", async () => {
    const failing = { error: { message: "boom" } };
    await expect(
      listMoneyCategories(createSupabaseStub({ money_categories: [failing] }).client),
    ).rejects.toThrow("boom");
    await expect(
      listMoneyAccounts(createSupabaseStub({ money_accounts: [failing] }).client, "p-1"),
    ).rejects.toThrow("boom");
  });
});

describe("a transaction's edges", () => {
  it("keeps an unknown category's id, reads a numeric MCC, and reports no cashback as null", async () => {
    const row = {
      ...feedRow,
      source: "manual",
      card_label: null,
      cashback_amount: null,
      comment: null,
      source_comment: "из выписки",
      raw_payload: { operation: { mccString: 5814 } },
      line_items: [{ title: "Обед", amount: -500, category_id: "gone", line_status: "final" }],
      total_count: 1,
    };
    const stub = createSupabaseStub({}, { money_list_transactions_feed: { data: [row] } });

    const [transaction] = (
      await listMoneyTransactions(stub.client, { payerPersonId: "p-1", offset: 0, limit: 5 }, [])
    ).transactions;

    expect(transaction).toMatchObject({
      bank: "manual",
      card_label: null,
      mcc: "5814",
      cashback: null,
      comment: "из выписки",
    });
    expect(transaction.line_items[0]).toMatchObject({
      status: "final",
      category: { id: "gone", name: "gone", canonical_key: null },
    });
  });

  it("reads no MCC and no lines from a row that has neither", async () => {
    const row = { ...feedRow, raw_payload: null, line_items: null };
    const stub = createSupabaseStub({}, { money_list_transactions_feed: { data: [row] } });

    const [transaction] = (
      await listMoneyTransactions(stub.client, { payerPersonId: "p-1", offset: 0, limit: 5 }, [])
    ).transactions;

    expect(transaction.mcc).toBeNull();
    expect(transaction.line_items).toEqual([]);
  });
});
