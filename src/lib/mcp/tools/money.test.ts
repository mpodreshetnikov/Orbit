import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

const money = vi.hoisted(() => ({
  MONEY_FEED_MAX_LIMIT: 200,
  MONEY_MCP_DEFAULT_LIMIT: 100,
  MONEY_MCP_DETAIL_MAX_IDS: 50,
  MONEY_MCP_LINE_SEARCH_DEFAULT_LIMIT: 50,
  MONEY_MCP_LINE_SEARCH_MAX_LIMIT: 100,
  listMoneyTransactions: vi.fn(),
  listMoneyCategories: vi.fn(),
  listMoneyAccounts: vi.fn(),
  getMoneyTransactionDetails: vi.fn(),
  searchMoneyLineItems: vi.fn(),
  resolveCategoryFilter: vi.fn(),
  compactTransactionsFromPage: (page: {
    transactions: Array<{
      line_items: Array<{ category?: { canonical_key?: string | null } | null }>;
      [key: string]: unknown;
    }>;
    feedRows?: Array<{ line_item_count?: number; category_ids?: string[] }>;
  }) =>
    page.transactions.map((transaction, index) => {
      const { line_items, ...rest } = transaction;
      const row = page.feedRows?.[index];
      return {
        ...rest,
        line_item_count: row?.line_item_count ?? line_items.length,
        category_keys: [
          ...new Set(
            line_items
              .map((item) => item.category?.canonical_key)
              .filter((key): key is string => typeof key === "string" && key.length > 0),
          ),
        ],
      };
    }),
  toCompactTransaction: (transaction: {
    line_items: Array<{ category?: { canonical_key?: string | null } | null }>;
    [key: string]: unknown;
  }) => {
    const { line_items, ...rest } = transaction;
    return {
      ...rest,
      line_item_count: line_items.length,
      category_keys: [
        ...new Set(
          line_items
            .map((item) => item.category?.canonical_key)
            .filter((key): key is string => typeof key === "string" && key.length > 0),
        ),
      ],
    };
  },
}));
const regen = vi.hoisted(() => ({ readTimezonePreference: vi.fn() }));
const person = vi.hoisted(() => ({ resolvePerson: vi.fn(), listPeople: vi.fn() }));

vi.mock("../money/transactions", () => money);
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
          authUserId: "11111111-1111-4111-8111-111111111111",
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
  sort: "posted_at_desc",
  limit: 100,
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

function feedPage(
  transactions: Array<Record<string, unknown> & { line_items: unknown[] }> = [TRANSACTION],
  total = 1,
) {
  return {
    total,
    transactions,
    feedRows: transactions.map((transaction) => ({
      line_item_count: transaction.line_items.length,
      category_ids: [],
    })),
    categoryById: new Map(),
  };
}

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

beforeEach(() => {
  vi.clearAllMocks();
  person.resolvePerson.mockResolvedValue({ status: "ok", person: PERSON });
  regen.readTimezonePreference.mockResolvedValue("Europe/Moscow");
  money.listMoneyCategories.mockResolvedValue([]);
  money.listMoneyTransactions.mockResolvedValue(feedPage());
  money.getMoneyTransactionDetails.mockResolvedValue([
    {
      id: "t-1",
      posted_at: TRANSACTION.posted_at,
      amount: -1290,
      currency: "RUB",
      merchant_name: "VKUSVILL",
      line_items: TRANSACTION.line_items,
    },
  ]);
  money.searchMoneyLineItems.mockResolvedValue({
    total: 1,
    transactions: [
      {
        id: "t-1",
        posted_at: TRANSACTION.posted_at,
        amount: -1290,
        currency: "RUB",
        merchant_name: "VKUSVILL",
        account: TRANSACTION.account,
        matching_line_items: [{ title: "Молоко", amount: -400, category: null }],
        line_item_count: 2,
      },
    ],
  });
  money.resolveCategoryFilter.mockReturnValue({ ids: ["food", "coffee"], unknown: [] });
});

describe("list_money_transactions", () => {
  it("summarises each transaction by local day, counterparty, categories and bank", async () => {
    const result = await (await handlers()).get("list_money_transactions")!(DEFAULTS, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain(
      "2026-10-28 -1290.00 RUB to ВкусВилл [food] (2 lines) — T-Bank, Tinkoff Black",
    );
    expect(result.structuredContent?.transactions).toEqual([
      {
        id: TRANSACTION.id,
        posted_at: TRANSACTION.posted_at,
        amount: TRANSACTION.amount,
        currency: TRANSACTION.currency,
        merchant_name: TRANSACTION.merchant_name,
        bank: TRANSACTION.bank,
        account: TRANSACTION.account,
        counterparty: TRANSACTION.counterparty,
        line_item_count: 2,
        category_keys: ["food"],
      },
    ]);
    expect(result.structuredContent).toMatchObject({
      has_more: false,
      next_offset: null,
      limit: 100,
    });
  });

  it("asks the feed for a wide page without line jsonb", async () => {
    await (await handlers()).get("list_money_transactions")!(DEFAULTS, ctx);

    const [, , , options] = money.listMoneyTransactions.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { includeLineItems?: boolean },
    ];
    expect(options).toMatchObject({ includeLineItems: false });
  });

  it("keeps a large page of receipt-heavy rows inside a compact structured payload", async () => {
    const fat = Array.from({ length: 100 }, (_, index) => ({
      ...TRANSACTION,
      id: `t-${index}`,
      line_items: Array.from({ length: 20 }, (_, line) => ({
        title: `line-${line}`,
        amount: -10,
        category: { id: "coffee", name: "Кофе", canonical_key: "food" },
      })),
    }));
    money.listMoneyTransactions.mockResolvedValue(feedPage(fat, 400));

    const result = await (await handlers()).get("list_money_transactions")!(
      { ...DEFAULTS, limit: 100 },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      total: 400,
      offset: 0,
      limit: 100,
      has_more: true,
      next_offset: 100,
    });
    const listed = result.structuredContent?.transactions as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(100);
    expect(listed[0]).toMatchObject({ line_item_count: 20, category_keys: ["food"] });
    expect(listed[0]).not.toHaveProperty("line_items");
    expect(JSON.stringify(result.structuredContent).length).toBeLessThan(80_000);
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
      .mockResolvedValueOnce(feedPage([], 0))
      .mockResolvedValueOnce(feedPage([TRANSACTION], 12));

    const result = await (await handlers()).get("list_money_transactions")!(
      { ...DEFAULTS, offset: 50 },
      ctx,
    );

    expect(result.content[0].text).toContain("offset 50 is past the end");
  });

  it("offers the next offset while more rows remain", async () => {
    money.listMoneyTransactions.mockResolvedValue(feedPage([TRANSACTION], 120));

    const result = await (await handlers()).get("list_money_transactions")!(
      { ...DEFAULTS, limit: 1 },
      ctx,
    );

    expect(result.structuredContent).toMatchObject({
      has_more: true,
      next_offset: 1,
      limit: 1,
      total: 120,
    });
    expect(result.content[0].text).toContain("pass offset: 1");
  });

  it("still accepts the pre-timeout default limit of 50", async () => {
    await (await handlers()).get("list_money_transactions")!({ ...DEFAULTS, limit: 50 }, ctx);

    const [, query] = money.listMoneyTransactions.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(query.limit).toBe(50);
  });
});

describe("get_money_transaction_details", () => {
  it("returns receipt lines for the requested ids", async () => {
    const result = await (await handlers()).get("get_money_transaction_details")!(
      { transaction_ids: ["11111111-1111-4111-8111-111111111111"] },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(money.getMoneyTransactionDetails).toHaveBeenCalledWith(
      expect.anything(),
      "p-1",
      ["11111111-1111-4111-8111-111111111111"],
      [],
    );
    expect(result.structuredContent).toMatchObject({
      returned: 1,
      transactions: [expect.objectContaining({ id: "t-1", line_items: TRANSACTION.line_items })],
    });
  });

  it("returns an empty page when none of the ids belong to the person", async () => {
    money.getMoneyTransactionDetails.mockResolvedValue([]);

    const result = await (await handlers()).get("get_money_transaction_details")!(
      { transaction_ids: ["22222222-2222-4222-8222-222222222222"] },
      ctx,
    );

    expect(result.structuredContent).toMatchObject({ returned: 0, transactions: [] });
  });
});

describe("search_money_line_items", () => {
  it("returns matching lines for a Cyrillic query and pages", async () => {
    money.searchMoneyLineItems.mockResolvedValue({
      total: 80,
      transactions: [
        {
          id: "t-1",
          posted_at: TRANSACTION.posted_at,
          amount: -1290,
          currency: "RUB",
          merchant_name: "VKUSVILL",
          account: TRANSACTION.account,
          matching_line_items: [{ title: "Молоко", amount: -400, category: null }],
          line_item_count: 2,
        },
      ],
    });

    const result = await (await handlers()).get("search_money_line_items")!(
      { query: "МОЛОКО", limit: 50, offset: 0 },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(money.searchMoneyLineItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ search: "МОЛОКО", limit: 50, offset: 0 }),
      [],
    );
    expect(result.content[0].text).toContain("Молоко");
    expect(result.structuredContent).toMatchObject({
      query: "МОЛОКО",
      total: 80,
      has_more: true,
      next_offset: 50,
      transactions: [
        expect.objectContaining({
          matching_line_items: [expect.objectContaining({ title: "Молоко" })],
        }),
      ],
    });
  });

  it("reports empty results without inventing rows", async () => {
    money.searchMoneyLineItems.mockResolvedValue({ total: 0, transactions: [] });

    const result = await (await handlers()).get("search_money_line_items")!(
      { query: "xyz-none", limit: 50, offset: 0 },
      ctx,
    );

    expect(result.structuredContent).toMatchObject({
      total: 0,
      has_more: false,
      transactions: [],
    });
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
    money.listMoneyTransactions.mockResolvedValue(
      feedPage([
        {
          ...TRANSACTION,
          amount: 500,
          merchant_name: null,
          counterparty: { direction: "from", name: null, channel: null, bank: null },
          line_items: [],
        },
      ]),
    );

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

describe("the money grant", () => {
  it("is required: a health-only connection reads no money", async () => {
    const map = await handlers();
    const healthOnly = contextWith(["health:read", "health:write"]);

    for (const name of [
      "list_money_transactions",
      "get_money_transaction_details",
      "search_money_line_items",
      "list_money_accounts",
      "list_money_categories",
    ]) {
      const result = await map.get(name)!(
        {
          ...DEFAULTS,
          include_archived: false,
          query: "x",
          transaction_ids: ["11111111-1111-4111-8111-111111111111"],
        },
        healthOnly,
      );
      expect(result.isError, name).toBe(true);
      expect(result.content[0].text).toContain('"money:read"');
    }
    expect(money.listMoneyTransactions).not.toHaveBeenCalled();
    expect(money.getMoneyTransactionDetails).not.toHaveBeenCalled();
    expect(money.searchMoneyLineItems).not.toHaveBeenCalled();
    expect(money.listMoneyAccounts).not.toHaveBeenCalled();
    expect(money.listMoneyCategories).not.toHaveBeenCalled();
  });
});
