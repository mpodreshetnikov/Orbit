import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import MoneyReportsScreen from "@/screens/money-reports-screen";
import SelfAliasesScreen from "@/screens/self-aliases-screen";
import TodayScreen from "@/screens/today-screen";
import TransactionFormScreen from "@/screens/transaction-form-screen";
import { db, fail, fakeSession, rpcHandlers, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "today/index": TodayScreen,
  "today/spend": TransactionFormScreen,
  "money/reports/index": MoneyReportsScreen,
  "money/reports/aliases": SelfAliasesScreen,
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
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
    money_categories: [],
    money_transactions: [],
    money_line_items: [],
    money_transfer_self_aliases: [
      { id: "a1", person_id: PERSON.id, alias: "Макс П.", normalized_alias: "макс п" },
      { id: "a2", person_id: "someone-else", alias: "Чужой", normalized_alias: "чужой" },
    ],
  });
  rpcHandlers.money_get_budget_report = () => [];
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("a quick spend", () => {
  it("is one tap from today: the amount, then save", async () => {
    await renderScreens(routes, "/today");
    await fireEvent.press(await screen.findByLabelText("Добавить транзакцию"));
    await fireEvent.changeText(await screen.findByLabelText("Сумма"), "-350");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.money_transactions).toEqual([
        expect.objectContaining({ account_id: "acc-card", amount: -350 }),
      ]),
    );
  });
});

describe("the self-transfer aliases", () => {
  it("are reached from the report, added and deleted", async () => {
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByLabelText("Псевдонимы для переводов себе"));
    expect(await screen.findByText("Макс П.")).toBeOnTheScreen();
    expect(screen.getByText("макс п")).toBeOnTheScreen();
    expect(screen.queryByText("Чужой")).toBeNull();

    await fireEvent.press(screen.getByText("Добавить"));
    expect(screen.getByText("Введите псевдоним перед сохранением.")).toBeOnTheScreen();
    await fireEvent.changeText(
      screen.getByLabelText("Псевдонимы для переводов себе"),
      " Подрешетников ",
    );
    await fireEvent.press(screen.getByText("Добавить"));
    await waitFor(() =>
      expect(db.tables.money_transfer_self_aliases.at(-1)).toMatchObject({
        person_id: PERSON.id,
        alias: "Подрешетников",
      }),
    );
    expect(await screen.findByText("Подрешетников")).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText("Удалить: Макс П."));
    await waitFor(() => expect(screen.queryByText("Макс П.")).toBeNull());
  });

  it("say when there are none, and when a change fails", async () => {
    db.tables.money_transfer_self_aliases = [];
    await renderScreens(routes, "/money/reports/aliases");
    expect(await screen.findByText("Псевдонимов для переводов себе пока нет.")).toBeOnTheScreen();
    fail("money_transfer_self_aliases");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.changeText(screen.getByLabelText("Псевдонимы для переводов себе"), "Я");
    await fireEvent(screen.getByLabelText("Псевдонимы для переводов себе"), "submitEditing");
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "money_transfer_self_aliases is unavailable",
      ),
    );
  });
});
