import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { ActionSheetIOS, Alert } from "react-native";
import MoneyScreen from "@/screens/money-screen";
import TransactionFormScreen, { categoryOptions } from "@/screens/transaction-form-screen";
import { db, fail, fakeSession, rpcHandlers, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "money/index": MoneyScreen,
  "money/form": TransactionFormScreen,
};

const LINE = {
  id: "li-1",
  transaction_id: "tx-1",
  title: "Хлеб",
  amount: -350,
  quantity: 1,
  unit: "шт",
  line_status: "final",
  related_line_item_id: null,
  category_id: "cat-food",
  beneficiary_person_id: PERSON.id,
  assignment_method: "manual",
  assignment_rule_id: null,
  assignment_confidence: null,
  raw_payload: null,
};

const TX = {
  id: "tx-1",
  payer_person_id: PERSON.id,
  account_id: "acc-card",
  posted_at: "2026-10-21T09:00:00.000Z",
  amount: -350,
  currency: "RUB",
  transaction_type: "expense",
  status: "posted",
  merchant_name: "Пятёрочка",
  comment: "К ужину",
  is_transfer: false,
  money_cards: { id: "card", last4: "1234", card_label: "Зарплатная" },
  money_line_items: [LINE, { ...LINE, id: "li-2", title: "Молоко", amount: 0, category_id: null }],
};

const CATEGORIES = [
  {
    id: "cat-food",
    name_ru: "Продукты",
    name_en: "Food",
    category_kind: "canonical",
    sort_order: 1,
    depth: 0,
    parent_id: null,
  },
  {
    id: "cat-bakery",
    name_ru: "Выпечка",
    name_en: "Bakery",
    category_kind: "custom",
    canonical_category_id: "cat-food",
    sort_order: 1,
    depth: 1,
    parent_id: "cat-food",
  },
];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    persons: [PERSON, { id: "kate", name: "Kate", kind: "human" }],
    money_accounts: [
      {
        id: "acc-card",
        owner_person_id: PERSON.id,
        account_label: "Тинькофф",
        currency: "RUB",
        is_active: true,
      },
      {
        id: "acc-usd",
        owner_person_id: PERSON.id,
        account_label: "Доллары",
        currency: "USD",
        is_active: false,
      },
    ],
    money_categories: CATEGORIES,
    money_transactions: [TX],
    money_line_items: [
      LINE,
      { ...LINE, id: "li-2", title: "Молоко", amount: 0, category_id: null },
    ],
  });
  rpcHandlers.money_list_transactions_feed = () => [];
  rpcHandlers.money_transaction_feed_summary = () => [];
  rpcHandlers.get_money_merchant_default_categories = () => [
    { merchant_name: "Пятёрочка", category_id: "cat-bakery" },
  ];
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function pickOption(label: string) {
  jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementationOnce((options, callback) => callback(options.options.indexOf(label)));
}

describe("the transaction form", () => {
  it("adds a spend with the merchant's usual category, from the list's plus", async () => {
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByLabelText("Добавить транзакцию"));
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "-420");
    await fireEvent.changeText(screen.getByLabelText("Мерчант"), "пят");
    await fireEvent.press(await screen.findByText("Пятёрочка"));
    await fireEvent.changeText(screen.getByLabelText("Сумма 1"), "-420");
    await fireEvent.changeText(screen.getByLabelText("Комментарий"), " Круассаны ");
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() => expect(db.tables.money_transactions).toHaveLength(2));
    expect(db.tables.money_transactions[1]).toMatchObject({
      payer_person_id: PERSON.id,
      account_id: "acc-card",
      amount: -420,
      currency: "RUB",
      transaction_type: "expense",
      merchant_name: "Пятёрочка",
      comment: "Круассаны",
      source: "manual",
    });
    expect(db.tables.money_line_items[2]).toMatchObject({
      title: "Пятёрочка",
      amount: -420,
      quantity: 1,
      unit: "шт",
      category_id: "cat-bakery",
      beneficiary_person_id: PERSON.id,
    });
  });

  it("asks for an amount, and says when the line items do not add up", async () => {
    await renderScreens(routes, "/money/form");
    await fireEvent.press(await screen.findByText("Сохранить"));
    expect(screen.getByText("Введите сумму.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "-5");
    expect(screen.getByText("Сумма строк отличается от суммы транзакции.")).toBeOnTheScreen();
  });

  it("takes the currency of the account picked, and line items added and removed", async () => {
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByLabelText("Добавить транзакцию"));
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "10");
    pickOption("Доллары (USD) — Неактивен");
    await fireEvent.press(screen.getByLabelText("Счет: Тинькофф (RUB)"));
    pickOption("Доход");
    await fireEvent.press(screen.getByLabelText("Тип: Расход"));
    pickOption("В ожидании");
    await fireEvent.press(screen.getByLabelText("Статус: Проведена"));
    await fireEvent.press(screen.getByText("Добавить строку"));
    await fireEvent.changeText(screen.getByLabelText("Название 2"), "Кешбэк");
    await fireEvent.changeText(screen.getByLabelText("Сумма 2"), "10");
    await fireEvent.changeText(screen.getByLabelText("Кол-во 2"), "");
    await fireEvent.changeText(screen.getByLabelText("Ед. 2"), "");
    pickOption("Возврат");
    await fireEvent.press(screen.getAllByLabelText("Статус: Финальная")[1]);
    pickOption("Kate");
    await fireEvent.press(screen.getAllByLabelText("Получатель: Max")[1]);
    pickOption("  Выпечка");
    await fireEvent.press(screen.getAllByLabelText("Категория: Без категории")[1]);
    await fireEvent.press(screen.getByLabelText("Удалить 1"));
    await fireEvent(screen.getByTestId("posted-at"), "change", {
      nativeEvent: { timestamp: new Date(2026, 9, 20, 18, 30).getTime() },
    });
    await fireEvent.press(screen.getByText("Сохранить"));

    await waitFor(() => expect(db.tables.money_transactions).toHaveLength(2));
    expect(db.tables.money_transactions[1]).toMatchObject({
      account_id: "acc-usd",
      currency: "USD",
      transaction_type: "income",
      status: "pending",
      posted_at: new Date(2026, 9, 20, 18, 30).toISOString(),
      merchant_name: null,
    });
    expect(db.tables.money_line_items.slice(2)).toEqual([
      expect.objectContaining({
        title: "Кешбэк",
        amount: 10,
        quantity: null,
        unit: null,
        line_status: "returned",
        beneficiary_person_id: "kate",
        category_id: "cat-bakery",
        category_locked_by_user: true,
      }),
    ]);
  });

  it("says when saving fails", async () => {
    await renderScreens(routes, "/money/form");
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "-1");
    fail("money_transactions");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "money_transactions is unavailable",
      ),
    );
  });

  it("says when there is no account to put a transaction on", async () => {
    db.tables.money_accounts = [];
    await renderScreens(routes, "/money/form");
    expect(await screen.findByText("Пока нет счетов")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Сумма"), "-1");
    await fireEvent.press(screen.getByText("Сохранить"));
    expect(screen.getByText("Выберите счет.")).toBeOnTheScreen();
  });

  it("says when the transaction to edit is not there", async () => {
    await renderScreens(routes, "/money/form?id=gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("reads a decimal comma as a point, in the amount and the line items", async () => {
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByLabelText("Добавить транзакцию"));
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "-420,50");
    await fireEvent.changeText(screen.getByLabelText("Сумма 1"), "-420,50");
    expect(screen.queryByText("Сумма строк отличается от суммы транзакции.")).toBeNull();
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(db.tables.money_transactions).toHaveLength(2));
    expect(db.tables.money_transactions[1].amount).toBe(-420.5);
    expect(db.tables.money_line_items[2].amount).toBe(-420.5);
  });

  it("takes the transaction back when its line items cannot be saved", async () => {
    await renderScreens(routes, "/money/form");
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "-1");
    fail("money_line_items");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "money_line_items is unavailable"),
    );
    expect(db.tables.money_transactions.map((row) => row.id)).toEqual(["tx-1"]);
  });

  it("moves an edited transaction to the currency of the account picked", async () => {
    await renderScreens(routes, "/money");
    await screen.findByLabelText("Добавить транзакцию");
    await act(() => router.push("/money/form?id=tx-1"));
    pickOption("Доллары (USD) — Неактивен");
    await fireEvent.press(await screen.findByLabelText("Счет: Тинькофф (RUB)"));
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.money_transactions[0]).toMatchObject({
        account_id: "acc-usd",
        currency: "USD",
      }),
    );
  });

  it("gives a merchant left early its usual category once that arrives", async () => {
    rpcHandlers.get_money_merchant_default_categories = () => [];
    const { client } = await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByLabelText("Добавить транзакцию"));
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "-1");
    const merchant = screen.getByLabelText("Мерчант");
    await fireEvent.changeText(merchant, "Пятёрочка");
    await fireEvent(merchant, "endEditing");
    expect(screen.getByLabelText("Категория: Без категории")).toBeOnTheScreen();
    rpcHandlers.get_money_merchant_default_categories = () => [
      { merchant_name: "Пятёрочка", category_id: "cat-bakery" },
    ];
    await act(() => client.invalidateQueries());
    expect(await screen.findByLabelText("Категория: Выпечка")).toBeOnTheScreen();
  });

  it("offers a retry when the person cannot be read", async () => {
    fail("persons");
    await renderScreens(routes, "/money/form");
    expect(await screen.findByText("persons is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByLabelText("Сумма")).toBeOnTheScreen();
  });

  it("offers a retry when the accounts cannot be read", async () => {
    fail("money_accounts");
    await renderScreens(routes, "/money/form?id=tx-1");
    expect(await screen.findByText("money_accounts is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect((await screen.findByLabelText("Сумма")).props.value).toBe("-350");
  });

  it("offers a retry when the transaction cannot be read", async () => {
    fail("money_transactions");
    await renderScreens(routes, "/money/form?id=tx-1");
    expect(await screen.findByText("money_transactions is unavailable")).toBeOnTheScreen();
    db.failing.clear();
    await fireEvent.press(screen.getByText("Повторить"));
    expect((await screen.findByLabelText("Сумма")).props.value).toBe("-350");
  });
});

describe("categoryOptions", () => {
  it("lists none first, then each category under its parent", () => {
    expect(categoryOptions(CATEGORIES as never).map(([, label]) => label)).toEqual([
      "Без категории",
      "Продукты",
      "  Выпечка",
    ]);
  });
});
