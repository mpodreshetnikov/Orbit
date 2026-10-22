import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { byDay, dayHeading } from "@/screens/money-screen";
import MoneyScreen from "@/screens/money-screen";
import {
  calls,
  db,
  fail,
  fakeSession,
  rpcHandlers,
  seed,
  setSession,
} from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = { "money/index": MoneyScreen };

function transaction(id: string, day: number, amount: number, extra = {}) {
  return {
    id,
    payer_person_id: PERSON.id,
    account_id: "acc-card",
    posted_at: new Date(2026, 9, day, 12).toISOString(),
    amount,
    currency: "RUB",
    transaction_type: amount < 0 ? "expense" : "income",
    status: "posted",
    merchant_name: `Покупка ${id}`,
    comment: null,
    source_comment: null,
    category_ids: [],
    ...extra,
  };
}

const FEED = [
  transaction("t1", 21, -350.5, {
    merchant_name: "Пятёрочка",
    category_ids: ["cat-food", "gone"],
    source_comment: "Оплата картой",
    line_items: [{ title: "Хлеб" }, { title: " Молоко " }],
    card_label: "Зарплатная",
  }),
  transaction("t2", 21, 50000, { merchant_name: null, transaction_type: "income" }),
  transaction("t3", 20, -120, {
    transaction_type: "transfer",
    comment: "Себе",
    account_id: "gone",
  }),
];

let feed = FEED;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  feed = FEED;
  seed({
    ...household(),
    money_accounts: [
      {
        id: "acc-card",
        owner_person_id: PERSON.id,
        account_label: "Тинькофф",
        currency: "RUB",
        is_active: true,
      },
    ],
    money_categories: [
      {
        id: "cat-food",
        name_ru: "Продукты",
        name_en: "Groceries",
        category_kind: "canonical",
        sort_order: 1,
        depth: 0,
      },
    ],
  });
  rpcHandlers.money_list_transactions_feed = (args) => {
    const sign = args.p_amount_sign;
    const rows = feed.filter((row) =>
      sign === "income" ? row.amount > 0 : sign === "expense" ? row.amount < 0 : true,
    );
    const offset = args.p_offset as number;
    return rows.slice(offset, offset + (args.p_limit as number));
  };
  rpcHandlers.money_transaction_feed_summary = () => [
    { total_count: 3, total_positive_amount: 50000, total_negative_amount: -470.5 },
  ];
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the money tab", () => {
  it("lists the transactions by day with their categories, comments, items and accounts", async () => {
    await renderScreens(routes, "/money");
    expect(await screen.findByText("Пятёрочка")).toBeOnTheScreen();
    expect(screen.getByText(dayHeading(FEED[0].posted_at).toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText(dayHeading(FEED[2].posted_at).toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText("Продукты, gone")).toBeOnTheScreen();
    expect(screen.getByText("Оплата картой")).toBeOnTheScreen();
    expect(screen.getByText("Хлеб, Молоко")).toBeOnTheScreen();
    expect(screen.getByText("Тинькофф / Зарплатная")).toBeOnTheScreen();
    expect(screen.getByText(/^-350,50\s₽$/)).toBeOnTheScreen();
    expect(screen.getByText("Ручная транзакция")).toBeOnTheScreen();
    expect(screen.getAllByText("Без категории")).toHaveLength(2);
    expect(screen.getByText("Себе")).toBeOnTheScreen();
    expect(screen.getByText("-")).toBeOnTheScreen();
    expect(await screen.findByText("3")).toBeOnTheScreen();
    expect(screen.getAllByText(/^50\s000,00\s₽$/)).toHaveLength(2);
  });

  it("narrows to money in", async () => {
    await renderScreens(routes, "/money");
    await screen.findByText("Пятёрочка");
    await fireEvent.press(screen.getByText("Доходы"));
    expect(await screen.findByText("Ручная транзакция")).toBeOnTheScreen();
    expect(screen.queryByText("Пятёрочка")).toBeNull();
    expect(calls.rpc.at(-1)?.args).toMatchObject({ p_amount_sign: "income", p_search: null });
  });

  it("loads the next page as the list nears its end", async () => {
    feed = Array.from({ length: 55 }, (_, index) => transaction(`p${index}`, 21, -index - 1));
    await renderScreens(routes, "/money");
    await screen.findByText("Покупка p0");
    const pages = () => calls.rpc.filter((call) => call.name === "money_list_transactions_feed");
    expect(pages()).toHaveLength(1);
    await fireEvent(screen.getByTestId("money-feed"), "endReached");
    await waitFor(() => expect(pages()).toHaveLength(2));
    expect(pages()[1].args).toMatchObject({ p_offset: 50 });
    await fireEvent(screen.getByTestId("money-feed"), "endReached");
    expect(pages()).toHaveLength(2);
  });

  it("says when there are none", async () => {
    feed = [];
    await renderScreens(routes, "/money");
    expect(await screen.findByText("Пока нет транзакций")).toBeOnTheScreen();
  });

  it("says when the feed or its sums cannot be read, and tries again", async () => {
    fail("money_transaction_feed_summary");
    await renderScreens(routes, "/money");
    expect(
      await screen.findByText("Итоги не пришли: money_transaction_feed_summary failed"),
    ).toBeOnTheScreen();

    db.failing.clear();
    fail("money_list_transactions_feed");
    await fireEvent.press(screen.getByText("Доходы"));
    expect(
      await screen.findByText("Не удалось загрузить операции: money_list_transactions_feed failed"),
    ).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByText("Ручная транзакция")).toBeOnTheScreen();
  });
});

describe("byDay", () => {
  it("keeps one heading per day, in the feed's order", () => {
    expect(byDay(FEED as never).map((day) => day.data.length)).toEqual([2, 1]);
  });
});
