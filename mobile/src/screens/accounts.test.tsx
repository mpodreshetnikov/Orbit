import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert, type AlertButton } from "react-native";
import AccountFormScreen, { CardFormScreen } from "@/screens/account-forms-screen";
import AccountsScreen from "@/screens/accounts-screen";
import MoneyScreen from "@/screens/money-screen";
import { db, fail, fakeSession, rpcHandlers, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "money/index": MoneyScreen,
  "money/accounts/index": AccountsScreen,
  "money/accounts/form": AccountFormScreen,
  "money/accounts/card": CardFormScreen,
};

const CARD_ACCOUNT = {
  id: "acc-card",
  owner_person_id: PERSON.id,
  source: "tbank",
  account_kind: "debit",
  account_label: "Тинькофф",
  currency: "RUB",
  external_account_id: null,
  is_active: true,
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({
    ...household(),
    money_accounts: [
      CARD_ACCOUNT,
      {
        ...CARD_ACCOUNT,
        id: "acc-cash",
        account_label: "Наличные",
        account_kind: "cash",
        source: "manual",
        is_active: false,
      },
    ],
    money_cards: [
      { id: "card-1", account_id: "acc-card", last4: "1234", card_label: "Зарплатная" },
    ],
  });
  rpcHandlers.money_list_transactions_feed = () => [];
  rpcHandlers.money_transaction_feed_summary = () => [];
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

async function answerAlert(label: string) {
  const alert = jest.spyOn(Alert, "alert");
  await waitFor(() => expect(alert).toHaveBeenCalled());
  (alert.mock.calls.at(-1)?.[2] as AlertButton[])
    .find((button) => button.text === label)
    ?.onPress?.();
}

describe("the accounts", () => {
  it("are reached from the money tab, each with its kind, source and cards", async () => {
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByText("Счета"));
    expect(await screen.findByText("Тинькофф")).toBeOnTheScreen();
    expect(screen.getByText("Дебетовая · RUB")).toBeOnTheScreen();
    expect(screen.getByText("tbank")).toBeOnTheScreen();
    expect(await screen.findByText("*1234 — Зарплатная")).toBeOnTheScreen();
    expect(screen.getByText("Неактивен")).toBeOnTheScreen();
    expect(screen.getByText("Нет карт")).toBeOnTheScreen();
  });

  it("gain one from the plus", async () => {
    await renderScreens(routes, "/money/accounts");
    await fireEvent.press(await screen.findByLabelText("Добавить счет"));
    await fireEvent.press(await screen.findByText("Сохранить"));
    expect(screen.getByText("Обязательное поле")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Название"), " Альфа ");
    pickOption("Кредитная");
    await fireEvent.press(screen.getByLabelText("Тип: Карта"));
    pickOption("USD");
    await fireEvent.press(screen.getByLabelText("Валюта: RUB"));
    pickOption("Альфа-Банк");
    await fireEvent.press(screen.getByLabelText("Источник: Вручную"));
    await fireEvent.changeText(screen.getByLabelText("Внешний ID"), " 40817 ");
    await fireEvent(screen.getByLabelText("Активен"), "valueChange", false);
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(db.tables.money_accounts).toHaveLength(3));
    expect(db.tables.money_accounts[2]).toEqual(
      expect.objectContaining({
        owner_person_id: PERSON.id,
        account_label: "Альфа",
        account_kind: "credit",
        currency: "USD",
        source: "alfa",
        external_account_id: "40817",
        is_active: false,
      }),
    );
  });

  it("change one from its menu, and lose one once confirmed", async () => {
    await renderScreens(routes, "/money/accounts");
    pickOption("Редактировать");
    await fireEvent.press(await screen.findByLabelText("Действия: Тинькофф"));
    const label = await screen.findByLabelText("Название");
    expect(label.props.value).toBe("Тинькофф");
    await fireEvent.changeText(label, "Т-Банк");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(db.tables.money_accounts[0].account_label).toBe("Т-Банк"));

    pickOption("Удалить");
    await fireEvent.press(await screen.findByLabelText("Действия: Наличные"));
    await answerAlert("Удалить");
    await waitFor(() => expect(db.tables.money_accounts).toHaveLength(1));
  });

  it("take, change and lose cards", async () => {
    await renderScreens(routes, "/money/accounts");
    await fireEvent.press((await screen.findAllByText("Добавить карту"))[1]);
    await fireEvent.changeText(await screen.findByLabelText("Последние 4 цифры"), "абв");
    await fireEvent.press(screen.getByText("Сохранить"));
    expect(screen.getByText("Обязательное поле")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Последние 4 цифры"), "4000 0000 0000 9876");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(db.tables.money_cards).toHaveLength(2));
    expect(db.tables.money_cards[1]).toMatchObject({
      account_id: "acc-cash",
      last4: "9876",
      card_label: null,
    });

    pickOption("Изменить карту");
    await fireEvent.press(await screen.findByText("*1234 — Зарплатная"));
    await fireEvent.changeText(
      await screen.findByLabelText("Название карты (необяз.)"),
      "Кредитка",
    );
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() => expect(db.tables.money_cards[0].card_label).toBe("Кредитка"));

    pickOption("Удалить");
    await fireEvent.press(await screen.findByText("*1234 — Кредитка"));
    await answerAlert("Удалить");
    await waitFor(() =>
      expect(db.tables.money_cards.map((card) => card.id)).not.toContain("card-1"),
    );
  });

  it("say when there are none, and when saving fails", async () => {
    db.tables.money_accounts = [];
    await renderScreens(routes, "/money/accounts");
    expect(await screen.findByText("Добавьте счет, чтобы учитывать транзакции.")).toBeOnTheScreen();
    await fireEvent.press(await screen.findByText("Добавить счет"));
    await fireEvent.changeText(await screen.findByLabelText("Название"), "Касса");
    fail("money_accounts");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Что-то пошло не так", "money_accounts is unavailable"),
    );
  });

  it("say when the account or card to edit is not there", async () => {
    await renderScreens(routes, "/money/accounts/form?id=gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });

  it("say when the card to edit is not there", async () => {
    await renderScreens(routes, "/money/accounts/card?account=acc-card&id=gone");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});
