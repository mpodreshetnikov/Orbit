import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, type AlertButton } from "react-native";
import MoneyScreen from "@/screens/money-screen";
import TransactionFormScreen from "@/screens/transaction-form-screen";
import TransactionScreen from "@/screens/transaction-screen";
import { db, fakeSession, rpcHandlers, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "money/index": MoneyScreen,
  "money/[id]": TransactionScreen,
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

function answerAlert(label: string) {
  jest.spyOn(Alert, "alert").mockImplementationOnce((_title, _message, buttons) => {
    (buttons as AlertButton[]).find((button) => button.text === label)?.onPress?.();
  });
}

describe("a transaction", () => {
  it("shows its kind, amount, account, card, comment and line items", async () => {
    await renderScreens(routes, "/money/tx-1");
    expect(await screen.findAllByText(/^-350,00\s₽$/)).toHaveLength(2);
    expect(screen.getByText("Расход")).toBeOnTheScreen();
    expect(screen.getByText("Проведена")).toBeOnTheScreen();
    expect(await screen.findByText("Тинькофф")).toBeOnTheScreen();
    expect(screen.getByText("*1234 (Зарплатная)")).toBeOnTheScreen();
    expect(screen.getByText("К ужину")).toBeOnTheScreen();
    expect(screen.getByText("Хлеб")).toBeOnTheScreen();
    expect(await screen.findByText("Продукты")).toBeOnTheScreen();
    expect(screen.getByText("Без категории")).toBeOnTheScreen();
  });

  it("is deleted once confirmed", async () => {
    rpcHandlers.money_list_transactions_feed = () => [TX];
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByText("Пятёрочка"));
    pickOption("Удалить транзакцию");
    answerAlert("Удалить транзакцию");
    await fireEvent.press(await screen.findByLabelText("Действия: Пятёрочка"));
    await waitFor(() => expect(db.tables.money_transactions).toHaveLength(0));
  });

  it("says when it is not there", async () => {
    await renderScreens(routes, "/money/gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});

describe("editing a transaction", () => {
  it("edits from the page's sheet: a line item changed, one dropped", async () => {
    await renderScreens(routes, "/money/tx-1");
    pickOption("Редактировать");
    await fireEvent.press(await screen.findByLabelText("Действия: Пятёрочка"));
    const merchant = await screen.findByLabelText("Мерчант");
    expect(merchant.props.value).toBe("Пятёрочка");
    await fireEvent.changeText(screen.getByLabelText("Название 1"), "Батон");
    await fireEvent.press(screen.getByLabelText("Удалить 2"));
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.money_line_items.map((row) => [row.id, row.title])).toEqual([
        ["li-1", "Батон"],
      ]),
    );
    expect(db.tables.money_transactions[0]).toMatchObject({ amount: -350, comment: "К ужину" });
  });
});
