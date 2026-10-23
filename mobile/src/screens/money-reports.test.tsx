import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { useSaveTransaction } from "@/lib/queries";
import BudgetTargetScreen from "@/screens/budget-target-screen";
import MoneyReportsScreen from "@/screens/money-reports-screen";
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

const routes = {
  "money/index": MoneyScreen,
  "money/reports/index": MoneyReportsScreen,
  "money/reports/target": BudgetTargetScreen,
};

const REPORT = {
  report_month_start: "2026-10-01",
  actual_income: 100000,
  actual_expense: -42000,
  actual_net: 58000,
  target_expense: -40000,
  net_variance: -2000,
  category_rows: [
    {
      id: "food",
      name_en: "Food",
      name_ru: "Еда",
      actual_expense: -30000,
      actual_net: -30000,
      target_amount: -25000,
      variance_amount: -5000,
      direct_target_amount: -25000,
    },
    {
      id: "cafe",
      parent_id: "food",
      name_en: "Cafe",
      name_ru: "Кафе",
      actual_expense: -12000,
      actual_net: -12000,
    },
    {
      id: "salary",
      name_en: "Income",
      name_ru: "Доход",
      actual_income: 100000,
      actual_net: 100000,
    },
    { id: "other", name_en: "", name_ru: "Прочее", system_key: "uncategorized" },
  ],
  trend_points: [
    { date: "2026-10-01", actual_expense: -2000 },
    { date: "2026-10-02", actual_expense: -40000 },
  ],
  fx_status: { status: "approximated" },
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  seed({ ...household(), money_budget_targets: [] });
  rpcHandlers.money_list_transactions_feed = () => [];
  rpcHandlers.money_transaction_feed_summary = () => [];
  rpcHandlers.money_get_budget_report = () => [REPORT];
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const reportArgs = () =>
  calls.rpc.filter(({ name }) => name === "money_get_budget_report").map(({ args }) => args);

describe("the budget report", () => {
  it("is reached from the money tab, with its totals, rates warning, chart and categories", async () => {
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByText("Отчеты"));
    expect(await screen.findByText("Использован приблизительный курс")).toBeOnTheScreen();
    expect(screen.getByText(/^Для части конвертаций/)).toBeOnTheScreen();
    expect(screen.getByText("Фактические доходы")).toBeOnTheScreen();
    expect(screen.getAllByText(/^100\s000,00\s₽$/).length).toBeGreaterThan(0);
    expect(screen.getByText("ДИНАМИКА ПО ДНЯМ")).toBeOnTheScreen();
    expect(screen.getByText(/^30\s000,00\s₽ \/ 25\s000,00\s₽$/)).toBeOnTheScreen();
    expect(screen.getByText("Цель")).toBeOnTheScreen();
    expect(screen.getByText("Без категории")).toBeOnTheScreen();
    expect(screen.queryByText("Cafe")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Развернуть: Food"));
    expect(screen.getByText("Cafe")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Свернуть: Food"));
    expect(screen.queryByText("Cafe")).toBeNull();
    expect(calls.rpc.some(({ name }) => name === "money-fx-sync")).toBe(true);
  });

  it("changes month, currency and chart mode", async () => {
    await renderScreens(routes, "/money/reports");
    await screen.findByText("октябрь 2026 г.");
    await fireEvent.press(screen.getByLabelText("Следующий месяц"));
    expect(await screen.findByText("ноябрь 2026 г.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Предыдущий месяц"));
    await fireEvent.press(screen.getByLabelText("Предыдущий месяц"));
    await fireEvent.press(screen.getByText("USD"));
    await waitFor(() =>
      expect(reportArgs().at(-1)).toEqual({
        p_person_id: PERSON.id,
        p_month_start: "2026-09-01",
        p_report_currency: "USD",
      }),
    );
    await fireEvent.press(await screen.findByText("Доходы"));
    expect((await screen.findAllByText(/^100\s000,00\s\$$/)).length).toBeGreaterThan(1);
    rpcHandlers.money_get_budget_report = () => [{ ...REPORT, category_rows: [] }];
    await fireEvent.press(screen.getByLabelText("Предыдущий месяц")); // A month not yet fetched.
    await fireEvent.press(await screen.findByText("Итог"));
    expect(await screen.findByText(/^Для выбранного режима/)).toBeOnTheScreen();
  });

  it("says when the rates are missing, and when it cannot load", async () => {
    rpcHandlers.money_get_budget_report = () => ({
      ...REPORT,
      fx_status: { status: "missing", message: "Нет курса USD" },
    });
    await renderScreens(routes, "/money/reports");
    expect(await screen.findByText("Не хватает курсов валют")).toBeOnTheScreen();
    expect(screen.getByText("Нет курса USD")).toBeOnTheScreen();
    // The figures it could not compute are not shown as zeroes.
    expect(screen.queryByText("Фактические доходы")).toBeNull();
    expect(screen.queryByText("Категории")).toBeNull();
    fail("money_get_budget_report");
    await fireEvent.press(screen.getByLabelText("Следующий месяц"));
    expect(
      await screen.findByText(
        "Не удалось загрузить бюджетный отчет. money_get_budget_report failed",
      ),
    ).toBeOnTheScreen();
  });
});

describe("a category's target", () => {
  it("is set as an expense from its row", async () => {
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByLabelText("Изменить цель: Income"));
    const amount = await screen.findByLabelText("Сумма цели");
    expect(amount.props.value).toBe("");
    await fireEvent.press(screen.getByText("Сохранить"));
    expect(screen.getByText("Введите сумму больше нуля.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Расход"));
    await fireEvent.changeText(amount, "1500,5");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(db.tables.money_budget_targets).toEqual([
        expect.objectContaining({
          person_id: PERSON.id,
          category_id: "salary",
          month_start: "2026-10-01",
          target_amount: -1500.5,
          currency: "RUB",
        }),
      ]),
    );
  });

  it("opens on the one it has, and is deleted", async () => {
    db.tables.money_budget_targets = [
      {
        person_id: PERSON.id,
        category_id: "food",
        month_start: "2026-10-01",
        target_amount: -25000,
      },
      { person_id: PERSON.id, category_id: "food", month_start: "2026-09-01", target_amount: -1 },
    ];
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByLabelText("Изменить цель: Food"));
    expect((await screen.findByLabelText("Сумма цели")).props.value).toBe("25000");
    await fireEvent.press(screen.getByText("Удалить"));
    await waitFor(() => expect(db.tables.money_budget_targets).toHaveLength(1));
  });

  it("says when saving fails, and when the category is not in the report", async () => {
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByLabelText("Изменить цель: Income"));
    await fireEvent.changeText(await screen.findByLabelText("Сумма цели"), "10");
    fail("money_budget_targets");
    const alert = jest.spyOn(Alert, "alert");
    await fireEvent.press(screen.getByText("Сохранить"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Что-то пошло не так",
        "money_budget_targets is unavailable",
      ),
    );
  });

  it("says when the category is not in the report", async () => {
    await renderScreens(routes, "/money/reports/target?category=gone&month=2026-10&currency=RUB");
    expect(await screen.findByText("Ничего не найдено")).toBeOnTheScreen();
  });
});

describe("the report", () => {
  it("is read again once a transaction changes", async () => {
    const { client } = await renderScreens(routes, "/money/reports");
    expect(await screen.findByText("Фактические доходы")).toBeOnTheScreen();
    const reads = () => calls.rpc.filter((one) => one.name === "money_get_budget_report").length;
    const before = reads();
    const { result } = await renderHook(() => useSaveTransaction(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: "gone", remove: true }).catch(() => undefined);
    });
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });
});
