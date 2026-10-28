import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react-native";
import { useSaveTransaction } from "@/lib/queries";
import MoneyReportsScreen from "@/screens/money-reports-screen";
import MoneyScreen from "@/screens/money-screen";
import { calls, fail, fakeSession, rpcHandlers, seed, setSession } from "../../test/fake-supabase";
import { household, NOW, PERSON, USER_ID } from "../../test/fixtures";
import { renderScreens } from "../../test/render";

jest.mock("@/lib/supabase", () => jest.requireActual("../../test/fake-supabase"));

const routes = {
  "money/index": MoneyScreen,
  "money/reports/index": MoneyReportsScreen,
};

const months = (expense: number) =>
  Array.from({ length: 12 }, (_, index) => ({
    month_start: `2026-${String(index + 1).padStart(2, "0")}-01`,
    income: 0,
    expense: index === 9 ? expense : expense / 2,
  }));

const category = (
  id: string,
  name: string,
  amounts: { expense?: number; income?: number; previous?: number; lastYear?: number },
  extra: Record<string, unknown> = {},
) => ({
  id,
  parent_id: null,
  system_key: null,
  name_en: id,
  name_ru: name,
  has_children: false,
  income: amounts.income ?? 0,
  expense: amounts.expense ?? 0,
  previous_income: 0,
  previous_expense: amounts.previous ?? 0,
  last_year_income: 0,
  last_year_expense: amounts.lastYear ?? 0,
  months: months(amounts.expense ?? 0),
  ...extra,
});

/** What `money_get_spending_report` returns for October 2026, three weeks in. */
const REPORT = {
  period: {
    start: "2026-10-01",
    end: "2026-10-31",
    days: 31,
    previous_start: "2026-08-31",
    previous_end: "2026-09-30",
    last_year: 2025,
  },
  currency: "RUB",
  totals: {
    income: 100000,
    expense: 40000,
    net: 60000,
    previous_income: 90000,
    previous_expense: 50000,
    previous_net: 40000,
    last_year_income: 100000,
    last_year_expense: 32000,
    last_year_net: 68000,
  },
  forecast: { expense: 52000, days_left: 10 },
  categories: [
    category(
      "food",
      "Продукты",
      { expense: 30000, previous: 25000, lastYear: 30000 },
      {
        has_children: true,
      },
    ),
    category("market", "Рынок", { expense: 20000 }, { parent_id: "food" }),
    category("delivery", "Доставка", { expense: 10000 }, { parent_id: "food" }),
    category("cafe", "Кафе", { expense: 6000, previous: 8000 }),
    category("other", "Без категории", { expense: 4000 }, { system_key: "uncategorized" }),
    category("salary", "Зарплата", { income: 100000 }),
  ],
  days: Array.from({ length: 31 }, (_, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    income: 0,
    expense: index < 21 ? 1000 + index * 10 : 0,
  })),
  merchants: [
    {
      brand_id: "b1",
      name: "Пятёрочка",
      logo_url: "https://logo.test/5.png",
      expense: 12000,
      transaction_count: 14,
    },
    {
      brand_id: "b2",
      name: "ВкусВилл",
      base_color: "#16a34a",
      expense: 8000,
      transaction_count: 1,
    },
    { brand_id: null, name: "Кафе у дома", expense: 3000, transaction_count: 3 },
  ],
  fx_status: { status: "approximated", missing_conversions: [] },
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
      {
        id: "acc-cash",
        owner_person_id: PERSON.id,
        account_label: "Наличные",
        currency: "RUB",
        is_active: true,
      },
    ],
  });
  rpcHandlers.money_list_transactions_feed = () => [];
  rpcHandlers.money_transaction_feed_summary = () => [];
  rpcHandlers.money_get_spending_report = () => REPORT;
  setSession(fakeSession(USER_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const reportArgs = () =>
  calls.rpc.filter(({ name }) => name === "money_get_spending_report").map(({ args }) => args);

const amount = (text: string) => new RegExp(`^${text.replace(/ /g, "\\s")}\\s₽$`);

describe("the money report", () => {
  it("is reached from the money tab: totals with their changes, the forecast, the map, the list, the days and the shops", async () => {
    await renderScreens(routes, "/money");
    await fireEvent.press(await screen.findByText("Отчеты"));
    expect(await screen.findByTestId("spending-total-expense")).toHaveTextContent(amount("40 000"));
    expect(screen.getByTestId("spending-total-net")).toHaveTextContent(/^\+60\s000\s₽$/);
    expect(screen.getByText("▼ 20% к пред.")).toBeOnTheScreen();
    expect(screen.getByText("▲ 25% к ср. 2025")).toBeOnTheScreen();
    expect(screen.getByText("▲ 11% к пред.")).toBeOnTheScreen();
    expect(screen.getAllByText("0% к ср. 2025")).toHaveLength(2); // Income, and the food row.
    expect(screen.getByText("Октябрь 2026 г.")).toBeOnTheScreen();
    expect(screen.getByText("Прогноз на 31 октября")).toBeOnTheScreen();
    expect(screen.getByTestId("spending-forecast")).toHaveTextContent(/^≈ 52\s000\s₽$/);
    expect(screen.getByText(/^осталось 10 дней · /)).toBeOnTheScreen();
    expect(screen.getByText("Для части операций взят ближайший прошлый курс.")).toBeOnTheScreen();
    expect(screen.getByTestId("spending-treemap")).toBeOnTheScreen();
    expect(screen.getByTestId("spending-row-food")).toBeOnTheScreen();
    expect(screen.queryByTestId("spending-row-salary")).toBeNull();
    expect(screen.getByText("По дням")).toBeOnTheScreen();
    expect(screen.getByText("Пятёрочка")).toBeOnTheScreen();
    expect(screen.getByText("14 операций")).toBeOnTheScreen();
    expect(screen.getByText("1 операция")).toBeOnTheScreen();
    expect(screen.getByText("К")).toBeOnTheScreen(); // The initial of a shop without a logo.
    expect(reportArgs().at(-1)).toEqual({
      p_person_id: PERSON.id,
      p_start: "2026-10-01",
      p_end: "2026-10-31",
      p_report_currency: "RUB",
      p_account_ids: null,
      p_category_id: null,
    });
    expect(calls.rpc.some(({ name }) => name === "money-fx-sync")).toBe(true);
  });

  it("steps through periods, and switches to a week, the last 30 days or a range of its own", async () => {
    await renderScreens(routes, "/money/reports");
    await screen.findByText("Октябрь 2026 г.");
    await fireEvent.press(screen.getByLabelText("Следующий период"));
    expect(await screen.findByText("Ноябрь 2026 г.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Предыдущий период"));
    await fireEvent.press(screen.getByLabelText("Предыдущий период"));
    await waitFor(() =>
      expect(reportArgs().at(-1)).toMatchObject({ p_start: "2026-09-01", p_end: "2026-09-30" }),
    );

    await fireEvent.press(screen.getByText("Неделя"));
    await waitFor(() =>
      expect(reportArgs().at(-1)).toMatchObject({ p_start: "2026-10-19", p_end: "2026-10-25" }),
    );
    await fireEvent.press(screen.getByText("30 дней"));
    await waitFor(() =>
      expect(reportArgs().at(-1)).toMatchObject({ p_start: "2026-09-22", p_end: "2026-10-21" }),
    );

    await fireEvent.press(screen.getByText("Период…"));
    await fireEvent(screen.getByTestId("spending-from"), "change", {
      nativeEvent: { timestamp: new Date(2026, 9, 5, 12).getTime() },
    });
    await waitFor(() =>
      expect(reportArgs().at(-1)).toMatchObject({ p_start: "2026-10-05", p_end: "2026-10-21" }),
    );
    // A start after the end moves the end with it, so the range is never empty.
    await fireEvent(screen.getByTestId("spending-from"), "change", {
      nativeEvent: { timestamp: new Date(2026, 9, 25, 12).getTime() },
    });
    await waitFor(() =>
      expect(reportArgs().at(-1)).toMatchObject({ p_start: "2026-10-25", p_end: "2026-10-25" }),
    );
    await fireEvent(screen.getByTestId("spending-to"), "change", {
      nativeEvent: { timestamp: new Date(2026, 9, 28, 12).getTime() },
    });
    await waitFor(() =>
      expect(reportArgs().at(-1)).toMatchObject({ p_start: "2026-10-25", p_end: "2026-10-28" }),
    );
  });

  it("narrows to the accounts picked, and back to all of them", async () => {
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByText("Наличные"));
    await waitFor(() => expect(reportArgs().at(-1)).toMatchObject({ p_account_ids: ["acc-cash"] }));
    await fireEvent.press(screen.getByText("Тинькофф"));
    await waitFor(() =>
      expect(reportArgs().at(-1)).toMatchObject({ p_account_ids: ["acc-cash", "acc-card"] }),
    );
    await fireEvent.press(screen.getByText("Наличные"));
    await waitFor(() => expect(reportArgs().at(-1)).toMatchObject({ p_account_ids: ["acc-card"] }));
    await fireEvent.press(screen.getByText("Все счета"));
    await waitFor(() => expect(reportArgs().at(-1)).toMatchObject({ p_account_ids: null }));
  });

  it("opens a category's subcategories on the map, and filters the report by one without any", async () => {
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByLabelText(/^Продукты, 30\s000\s₽, 75%$/));
    expect(await screen.findByText(" › Продукты", { exact: false })).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Рынок, 20\s000\s₽, 67%$/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Все категории"));
    await waitFor(() => expect(screen.queryByLabelText(/^Рынок, /)).toBeNull());

    await fireEvent.press(screen.getByLabelText(/^Кафе, 6\s000\s₽, 15%$/));
    await waitFor(() => expect(reportArgs().at(-1)).toMatchObject({ p_category_id: "cafe" }));
    expect(await screen.findByText("Категория: Кафе")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Снять фильтр"));
    await waitFor(() => expect(reportArgs().at(-1)).toMatchObject({ p_category_id: null }));
    expect(screen.queryByText("Категория: Кафе")).toBeNull();
  });

  it("opens a row's subcategories, and filters the report by the row", async () => {
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByLabelText("Раскрыть «Продукты»"));
    expect(screen.getByText("Доставка")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Отчёт только по «Продукты»"));
    await waitFor(() => expect(reportArgs().at(-1)).toMatchObject({ p_category_id: "food" }));
    expect(await screen.findByText("Категория: Продукты")).toBeOnTheScreen();
    // Filtered, the list starts from the category's own subcategories, and the map's way back
    // leads to the filter rather than to all categories.
    expect(screen.getByTestId("spending-row-market")).toBeOnTheScreen();
    expect(screen.queryByTestId("spending-row-cafe")).toBeNull();
  });

  it("lists money booked on a parent itself beside its subcategories", async () => {
    rpcHandlers.money_get_spending_report = () => ({
      ...REPORT,
      categories: REPORT.categories.map((one) =>
        one.id === "market" ? { ...one, expense: 15000, months: months(15000) } : one,
      ),
    });
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByLabelText("Раскрыть «Продукты»"));
    expect(screen.getByText("Продукты: без подкатегории")).toBeOnTheScreen();
  });

  it("keeps the filter removable when the filtered report is empty", async () => {
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByLabelText(/^Кафе, /));
    rpcHandlers.money_get_spending_report = () => ({ ...REPORT, categories: [] });
    await fireEvent.press(screen.getByText("Наличные"));
    expect(await screen.findByText("Выбранная категория")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Снять фильтр"));
    await waitFor(() => expect(reportArgs().at(-1)).toMatchObject({ p_category_id: null }));
  });

  it("closes an open row again", async () => {
    await renderScreens(routes, "/money/reports");
    await fireEvent.press(await screen.findByLabelText("Раскрыть «Продукты»"));
    await fireEvent.press(screen.getByLabelText("Свернуть «Продукты»"));
    expect(screen.queryByText("Доставка")).toBeNull();
  });

  it("shows income by category on the income tab", async () => {
    await renderScreens(routes, "/money/reports");
    await screen.findByTestId("spending-row-food");
    await fireEvent.press(screen.getAllByText("Доходы").at(-1)!);
    expect(await screen.findByTestId("spending-row-salary")).toBeOnTheScreen();
    expect(screen.queryByTestId("spending-row-food")).toBeNull();
  });

  it("has no forecast once the period is over, and says when nothing moved", async () => {
    rpcHandlers.money_get_spending_report = () => ({
      ...REPORT,
      forecast: null,
      categories: [],
      days: [],
      merchants: [],
      fx_status: { status: "ok" },
    });
    await renderScreens(routes, "/money/reports");
    expect(await screen.findByText("За этот период операций нет.")).toBeOnTheScreen();
    expect(screen.queryByText(/^Прогноз/)).toBeNull();
    expect(screen.queryByText("По дням")).toBeNull();
    expect(screen.queryByText("Магазины")).toBeNull();
  });

  it("names the missing rates, and says when it cannot load", async () => {
    rpcHandlers.money_get_spending_report = () => ({
      ...REPORT,
      fx_status: {
        status: "error",
        missing_conversions: [{ conversion_date: "2026-10-15", source_currency: "USD" }],
      },
    });
    await renderScreens(routes, "/money/reports");
    expect(
      await screen.findByText(
        "Не хватает курсов валют, часть операций не посчитана: USD:2026-10-15.",
      ),
    ).toBeOnTheScreen();
    fail("money_get_spending_report");
    await fireEvent.press(screen.getByLabelText("Следующий период"));
    // The last report stays while the next loads; once that fails, the error replaces it.
    await waitFor(() => expect(reportArgs().at(-1)).toMatchObject({ p_start: "2026-11-01" }));
  });

  it("says it cannot load when the first read fails", async () => {
    fail("money_get_spending_report");
    await renderScreens(routes, "/money/reports");
    expect(await screen.findByText("Не удалось загрузить отчёт.")).toBeOnTheScreen();
  });

  it("is read again once a transaction changes", async () => {
    const { client } = await renderScreens(routes, "/money/reports");
    await screen.findByTestId("spending-total-expense");
    const before = reportArgs().length;
    const { result } = await renderHook(() => useSaveTransaction(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: "gone", remove: true }).catch(() => undefined);
    });
    await waitFor(() => expect(reportArgs().length).toBeGreaterThan(before));
  });
});
