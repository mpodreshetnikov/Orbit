import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

const money = vi.hoisted(() => ({
  MONEY_FEED_MAX_LIMIT: 200,
  listMoneyTransactions: vi.fn(),
  listMoneyCategories: vi.fn(),
  listMoneyAccounts: vi.fn(),
  resolveCategoryFilter: vi.fn(),
}));
const spending = vi.hoisted(() => ({ fetchMoneySpendingReport: vi.fn() }));
const regen = vi.hoisted(() => ({ readTimezonePreference: vi.fn() }));
const person = vi.hoisted(() => ({ resolvePerson: vi.fn(), listPeople: vi.fn() }));

vi.mock("../money/transactions", () => money);
vi.mock("../money/spending-report", () => spending);
vi.mock("@/lib/medications/regenerate-dose-events", () => regen);
vi.mock("../resolve-person", () => person);
vi.mock("../supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));

type Handler = (
  args: unknown,
  ctx: unknown,
) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

/** The money grant alone: none of these tools may need more. */
const ctx = contextWith(["money:read"]);

function contextWith(scopes: string[]) {
  return {
    http: {
      authInfo: {
        scopes,
        extra: {
          grantId: "g-1",
          authUserId: "11111111-1111-1111-1111-111111111111",
          userEmail: "u@example.com",
        },
      },
    },
  };
}

const PERSON = { id: "p-1", name: "Max", kind: "human" };
const DEFAULTS = {
  direction: "all",
  transfers: "all",
  include_bank_payload: false,
  limit: 50,
  offset: 0,
};

const TRANSACTION = {
  id: "t-1",
  // 21:30Z is already the next day in Moscow.
  posted_at: "2026-10-27T21:30:00Z",
  amount: -1290,
  currency: "RUB",
  merchant_name: "VKUSVILL",
  bank: "T-Bank",
  account: { id: "a-1", label: "Tinkoff Black", kind: "debit" },
  counterparty: { direction: "to", name: "ВкусВилл", channel: null, bank: null },
  line_items: [
    {
      title: "Кофе",
      amount: -890,
      category: { id: "coffee", name: "Кофе", canonical_key: "food" },
    },
    { title: "Молоко", amount: -400, category: null },
  ],
};

async function handlers(): Promise<Map<string, Handler>> {
  const { registerMoneyTools } = await import("./money");
  const map = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _c: unknown, handler: Handler) => {
      map.set(name, handler);
      return {} as never;
    }),
  } as unknown as McpToolServer;
  registerMoneyTools(server);
  return map;
}

const REPORT = {
  period: {
    start: "2026-11-01",
    end: "2026-11-30",
    days: 30,
    previous_start: "2026-10-02",
    previous_end: "2026-10-31",
    last_year: 2025,
  },
  currency: "RUB",
  totals: {
    income: 100_000,
    expense: 40_000,
    net: 60_000,
    previous_income: 90_000,
    previous_expense: 50_000,
    previous_net: 40_000,
    last_year_income: 80_000,
    last_year_expense: 35_000,
    last_year_net: 45_000,
  },
  forecast: { expense: 45_000, days_left: 10 },
  categories: [
    {
      id: "food",
      parent_id: null,
      system_key: "food",
      name_en: "Food",
      name_ru: "Еда",
      has_children: false,
      income: 0,
      expense: 12_000,
      previous_income: 0,
      previous_expense: 10_000,
      last_year_income: 0,
      last_year_expense: 9_000,
      months: [],
    },
    {
      id: "transport",
      parent_id: null,
      system_key: "transport",
      name_en: "Transport",
      name_ru: "Транспорт",
      has_children: false,
      income: 0,
      expense: 8_000,
      previous_income: 0,
      previous_expense: 7_000,
      last_year_income: 0,
      last_year_expense: 6_000,
      months: [],
    },
  ],
  days: [{ date: "2026-11-01", income: 0, expense: 1_000 }],
  merchants: [
    {
      brand_id: null,
      name: "Fixture Cafe",
      logo_url: null,
      base_color: null,
      expense: 3_000,
      transaction_count: 4,
    },
  ],
  fx_status: { status: "ok" as const, missing: [] as string[] },
};

const REPORT_DEFAULTS = {
  period: "month" as const,
  currency: "RUB",
};

beforeEach(() => {
  vi.clearAllMocks();
  person.resolvePerson.mockResolvedValue({ status: "ok", person: PERSON });
  regen.readTimezonePreference.mockResolvedValue("Europe/Moscow");
  money.listMoneyCategories.mockResolvedValue([]);
  money.listMoneyTransactions.mockResolvedValue({ total: 1, transactions: [TRANSACTION] });
  money.resolveCategoryFilter.mockReturnValue({ ids: ["food", "coffee"], unknown: [] });
  spending.fetchMoneySpendingReport.mockResolvedValue(REPORT);
});

describe("list_money_transactions", () => {
  it("summarises each transaction by local day, counterparty, categories and bank", async () => {
    const result = await (await handlers()).get("list_money_transactions")!(DEFAULTS, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain(
      "2026-10-28 -1290.00 RUB to ВкусВилл [Кофе] (2 lines) — T-Bank, Tinkoff Black",
    );
    expect(result.structuredContent?.transactions).toEqual([TRANSACTION]);
  });

  it("bounds dates by the user's local days and passes category ids with their subcategories", async () => {
    await (await handlers()).get("list_money_transactions")!(
      {
        ...DEFAULTS,
        from: "2026-10-01",
        to: "2026-10-31",
        categories: ["food"],
        search: "кофе",
        direction: "expense",
        amount_min: 1000,
        amount_max: 5000,
      },
      ctx,
    );

    const [, query] = money.listMoneyTransactions.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(query).toMatchObject({
      payerPersonId: "p-1",
      search: "кофе",
      categoryIds: ["food", "coffee"],
      amountSign: "expense",
      amountMin: 1000,
      amountMax: 5000,
      fromUtc: "2026-09-30T21:00:00.000Z",
      toUtc: "2026-10-31T20:59:59.999Z",
    });
  });

  it("refuses a category that does not exist instead of silently listing everything", async () => {
    money.resolveCategoryFilter.mockReturnValue({ ids: [], unknown: ["nope"] });

    const result = await (await handlers()).get("list_money_transactions")!(
      { ...DEFAULTS, categories: ["nope"] },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"nope"');
    expect(money.listMoneyTransactions).not.toHaveBeenCalled();
  });

  it("refuses amount bounds that cross instead of returning nothing", async () => {
    const result = await (await handlers()).get("list_money_transactions")!(
      { ...DEFAULTS, amount_min: 5000, amount_max: 1000 },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("amount_min (5000) is above amount_max (1000)");
    expect(money.listMoneyTransactions).not.toHaveBeenCalled();
  });

  it("tells an offset past the end apart from an empty result", async () => {
    money.listMoneyTransactions
      .mockResolvedValueOnce({ total: 0, transactions: [] })
      .mockResolvedValueOnce({ total: 12, transactions: [TRANSACTION] });

    const result = await (await handlers()).get("list_money_transactions")!(
      { ...DEFAULTS, offset: 50 },
      ctx,
    );

    expect(result.content[0].text).toContain("offset 50 is past the end");
  });

  it("offers the next offset while more rows remain", async () => {
    money.listMoneyTransactions.mockResolvedValue({ total: 120, transactions: [TRANSACTION] });

    const result = await (await handlers()).get("list_money_transactions")!(
      { ...DEFAULTS, limit: 1 },
      ctx,
    );

    expect(result.structuredContent?.next_offset).toBe(1);
    expect(result.content[0].text).toContain("pass offset: 1");
  });
});

describe("list_money_accounts and list_money_categories", () => {
  it("lists accounts by label without numbers", async () => {
    money.listMoneyAccounts.mockResolvedValue([
      {
        id: "a-1",
        account_label: "Tinkoff Black",
        account_kind: "debit",
        currency: "RUB",
        source: "tbank",
        is_active: true,
      },
    ]);

    const result = await (await handlers()).get("list_money_accounts")!({}, ctx);

    expect(result.content[0].text).toContain("Tinkoff Black (debit, RUB, tbank) id a-1");
  });

  it("names each category's canonical key and hides archived ones by default", async () => {
    money.listMoneyCategories.mockResolvedValue([
      {
        id: "food",
        parent_id: null,
        canonical_category_id: "food",
        system_key: "food",
        name_en: "Food",
        name_ru: "Еда",
        archived_at: null,
      },
      {
        id: "cafes",
        parent_id: "food",
        canonical_category_id: "food",
        system_key: null,
        name_en: "Cafes",
        name_ru: "Кафе",
        archived_at: null,
      },
      {
        id: "old",
        parent_id: "food",
        canonical_category_id: "food",
        system_key: null,
        name_en: "Old",
        name_ru: "Старое",
        archived_at: "2026-01-01",
      },
    ]);

    const result = await (await handlers()).get("list_money_categories")!(
      { include_archived: false },
      ctx,
    );

    expect(result.content[0].text).toContain("Кафе / Cafes under Еда id cafes");
    expect(result.content[0].text).not.toContain("Старое");
    expect(result.structuredContent?.categories).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "cafes", canonical_key: "food" })]),
    );
  });
});

describe("edges of the money tools", () => {
  it("refuses a timezone it does not know", async () => {
    const result = await (await handlers()).get("list_money_transactions")!(
      { ...DEFAULTS, timezone: "Mars/Olympus" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(money.listMoneyTransactions).not.toHaveBeenCalled();
  });

  it("uses an explicit timezone over the saved one, and UTC when neither exists", async () => {
    regen.readTimezonePreference.mockResolvedValue(null);
    const handler = (await handlers()).get("list_money_transactions")!;

    expect((await handler(DEFAULTS, ctx)).content[0].text).toContain("dates in UTC");
    expect(
      (await handler({ ...DEFAULTS, timezone: "Asia/Bangkok" }, ctx)).content[0].text,
    ).toContain("dates in Asia/Bangkok");
  });

  it("names an uncategorized transaction and a counterparty-less one", async () => {
    money.listMoneyTransactions.mockResolvedValue({
      total: 1,
      transactions: [
        {
          ...TRANSACTION,
          amount: 500,
          merchant_name: null,
          counterparty: { direction: "from", name: null, channel: null, bank: null },
          line_items: [],
        },
      ],
    });

    const result = await (await handlers()).get("list_money_transactions")!(DEFAULTS, ctx);

    expect(result.content[0].text).toContain("+500.00 RUB from unknown [uncategorized]");
  });

  it("marks inactive accounts and can include archived categories", async () => {
    money.listMoneyAccounts.mockResolvedValue([
      {
        id: "a-2",
        account_label: "Old card",
        account_kind: "card",
        currency: "RUB",
        source: "manual",
        is_active: false,
      },
    ]);
    money.listMoneyCategories.mockResolvedValue([
      {
        id: "old",
        parent_id: null,
        canonical_category_id: "old",
        system_key: null,
        name_en: "Old",
        name_ru: "Старое",
        archived_at: "2026-01-01",
      },
    ]);
    const map = await handlers();

    expect((await map.get("list_money_accounts")!({}, ctx)).content[0].text).toContain(
      "Old card (card, RUB, manual) — inactive",
    );
    expect(
      (await map.get("list_money_categories")!({ include_archived: true }, ctx)).content[0].text,
    ).toContain("Старое / Old id old");
  });
});

describe("get_money_spending_report", () => {
  it("summarises period totals, top categories and merchants without the feed", async () => {
    const result = await (await handlers()).get("get_money_spending_report")!(REPORT_DEFAULTS, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("spending report for Max");
    expect(result.content[0].text).toContain("2026-11-01…2026-11-30");
    expect(result.content[0].text).toContain("expense 40000.00 RUB");
    expect(result.content[0].text).toContain("Еда 12000.00");
    expect(result.content[0].text).toContain("Fixture Cafe 3000.00");
    expect(result.content[0].text).toContain("forecast 45000.00");
    expect(result.structuredContent?.report).toEqual(REPORT);
    expect(spending.fetchMoneySpendingReport.mock.calls[0]?.[1]).toMatchObject({
      personId: "p-1",
      currency: "RUB",
      accountIds: [],
      categoryId: null,
      period: { start: "2026-11-01", end: "2026-11-30" },
    });
    expect(money.listMoneyTransactions).not.toHaveBeenCalled();
  });

  it("resolves a single category filter and custom dates", async () => {
    money.listMoneyCategories.mockResolvedValue([
      {
        id: "food",
        parent_id: null,
        canonical_category_id: "food",
        category_kind: "canonical",
        system_key: "food",
        name_en: "Food",
        name_ru: "Еда",
        archived_at: null,
      },
    ]);

    await (await handlers()).get("get_money_spending_report")!(
      {
        period: "custom",
        from: "2026-10-01",
        to: "2026-10-15",
        category: "food",
        account_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
        currency: "USD",
      },
      ctx,
    );

    expect(spending.fetchMoneySpendingReport.mock.calls[0]?.[1]).toMatchObject({
      currency: "USD",
      accountIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      categoryId: "food",
      period: { start: "2026-10-01", end: "2026-10-15" },
    });
  });

  it("refuses an unknown category and a backwards custom range", async () => {
    money.listMoneyCategories.mockResolvedValue([]);
    const handler = (await handlers()).get("get_money_spending_report")!;

    const unknown = await handler({ ...REPORT_DEFAULTS, category: "nope" }, ctx);
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain("No category matches");
    expect(spending.fetchMoneySpendingReport).not.toHaveBeenCalled();

    const badRange = await handler(
      { period: "custom", from: "2026-10-15", to: "2026-10-01", currency: "RUB" },
      ctx,
    );
    expect(badRange.isError).toBe(true);
    expect(spending.fetchMoneySpendingReport).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous category name and lists candidate ids", async () => {
    money.listMoneyCategories.mockResolvedValue([
      {
        id: "books-edu",
        parent_id: "education",
        canonical_category_id: "education",
        category_kind: "custom",
        system_key: null,
        name_en: "Books",
        name_ru: "Книги",
        archived_at: null,
      },
      {
        id: "books-fun",
        parent_id: "entertainment",
        canonical_category_id: "entertainment",
        category_kind: "custom",
        system_key: null,
        name_en: "Books",
        name_ru: "Книги",
        archived_at: null,
      },
    ]);

    const result = await (await handlers()).get("get_money_spending_report")!(
      { ...REPORT_DEFAULTS, category: "Books" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("matches more than one category");
    expect(result.content[0].text).toContain("books-edu");
    expect(result.content[0].text).toContain("books-fun");
    expect(result.structuredContent?.candidates).toEqual([
      { id: "books-edu", name_ru: "Книги", name_en: "Books" },
      { id: "books-fun", name_ru: "Книги", name_en: "Books" },
    ]);
    expect(spending.fetchMoneySpendingReport).not.toHaveBeenCalled();
  });

  it("summarises filtered categories under the selected branch, not the roots", async () => {
    spending.fetchMoneySpendingReport.mockResolvedValue({
      ...REPORT,
      categories: [
        {
          id: "food",
          parent_id: null,
          system_key: "food",
          name_en: "Food",
          name_ru: "Еда",
          has_children: true,
          income: 0,
          expense: 20_000,
          previous_income: 0,
          previous_expense: 18_000,
          last_year_income: 0,
          last_year_expense: 15_000,
          months: [],
        },
        {
          id: "cafe",
          parent_id: "food",
          system_key: null,
          name_en: "Cafe",
          name_ru: "Кафе",
          has_children: false,
          income: 0,
          expense: 12_000,
          previous_income: 0,
          previous_expense: 10_000,
          last_year_income: 0,
          last_year_expense: 9_000,
          months: [],
        },
        {
          id: "takeout",
          parent_id: "food",
          system_key: null,
          name_en: "Takeout",
          name_ru: "Еда навынос",
          has_children: false,
          income: 0,
          expense: 8_000,
          previous_income: 0,
          previous_expense: 8_000,
          last_year_income: 0,
          last_year_expense: 6_000,
          months: [],
        },
      ],
    });
    money.listMoneyCategories.mockResolvedValue([
      {
        id: "food",
        parent_id: null,
        canonical_category_id: "food",
        category_kind: "canonical",
        system_key: "food",
        name_en: "Food",
        name_ru: "Еда",
        archived_at: null,
      },
    ]);

    const result = await (await handlers()).get("get_money_spending_report")!(
      { ...REPORT_DEFAULTS, category: "food" },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Кафе 12000.00");
    expect(result.content[0].text).toContain("Еда навынос 8000.00");
    // Root rollup must not replace the branch breakdown in the summary.
    expect(result.content[0].text).not.toMatch(/top categories:\n {2}- Еда 20000\.00/);
  });
});

describe("the money grant", () => {
  it("is required: a health-only connection reads no money", async () => {
    const map = await handlers();
    const healthOnly = contextWith(["health:read", "health:write"]);

    for (const name of [
      "list_money_transactions",
      "list_money_accounts",
      "list_money_categories",
      "get_money_spending_report",
    ]) {
      const result = await map.get(name)!(
        { ...DEFAULTS, ...REPORT_DEFAULTS, include_archived: false },
        healthOnly,
      );
      expect(result.isError, name).toBe(true);
      expect(result.content[0].text).toContain('"money:read"');
    }
    expect(money.listMoneyTransactions).not.toHaveBeenCalled();
    expect(money.listMoneyAccounts).not.toHaveBeenCalled();
    expect(money.listMoneyCategories).not.toHaveBeenCalled();
    expect(spending.fetchMoneySpendingReport).not.toHaveBeenCalled();
  });
});
