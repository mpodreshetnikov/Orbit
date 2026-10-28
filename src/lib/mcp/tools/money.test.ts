import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

const money = vi.hoisted(() => ({
  MONEY_FEED_MAX_LIMIT: 200,
  listMoneyTransactions: vi.fn(),
  listMoneyCategories: vi.fn(),
  listMoneyAccounts: vi.fn(),
  resolveCategoryFilter: vi.fn(),
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

/** A read-only grant: none of these tools may need more. */
const ctx = {
  http: {
    authInfo: {
      scopes: ["health:read"],
      extra: {
        grantId: "g-1",
        authUserId: "11111111-1111-1111-1111-111111111111",
        userEmail: "u@example.com",
      },
    },
  },
};

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

beforeEach(() => {
  vi.clearAllMocks();
  person.resolvePerson.mockResolvedValue({ status: "ok", person: PERSON });
  regen.readTimezonePreference.mockResolvedValue("Europe/Moscow");
  money.listMoneyCategories.mockResolvedValue([]);
  money.listMoneyTransactions.mockResolvedValue({ total: 1, transactions: [TRANSACTION] });
  money.resolveCategoryFilter.mockReturnValue({ ids: ["food", "coffee"], unknown: [] });
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
