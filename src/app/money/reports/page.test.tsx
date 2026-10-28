import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpendingCategory, SpendingReport } from "@/types/money-spending-report";
import MoneyReportsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useIsMobile: vi.fn(),
  useMoneyAccounts: vi.fn(),
  useMoneySpendingReport: vi.fn(),
}));

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }));

let selectedPersonIdState: string | null = "person-1";
let currentSearchParams = new URLSearchParams();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join("|")})` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  useIsMobile: (...args: unknown[]) => hookMocks.useIsMobile(...args),
  useMoneyAccounts: (...args: unknown[]) => hookMocks.useMoneyAccounts(...args),
  useMoneySpendingReport: (...args: unknown[]) => hookMocks.useMoneySpendingReport(...args),
}));

vi.mock("@/lib/date-locale", () => ({ useIntlLocale: () => "en-US" }));

// Every popover renders open: what is inside is what is under test, not Radix.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function months(expense: number) {
  return Array.from({ length: 12 }, (_, index) => ({
    month_start: `2026-${String(index + 1).padStart(2, "0")}-01`,
    income: 0,
    expense: index === 11 ? expense : expense / 2,
  }));
}

function category(
  overrides: Partial<SpendingCategory> & Pick<SpendingCategory, "id">,
): SpendingCategory {
  return {
    parent_id: null,
    system_key: null,
    name_en: overrides.id,
    name_ru: overrides.id,
    has_children: false,
    income: 0,
    expense: 0,
    previous_income: 0,
    previous_expense: 0,
    last_year_income: 0,
    last_year_expense: 0,
    months: months(overrides.expense ?? 0),
    ...overrides,
  };
}

const REPORT: SpendingReport = {
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
    income: 185000,
    expense: 118420,
    net: 66580,
    previous_income: 185000,
    previous_expense: 109650,
    previous_net: 75350,
    last_year_income: 174528,
    last_year_expense: 122082,
    last_year_net: 52446,
  },
  forecast: { expense: 131000, days_left: 3 },
  categories: [
    category({
      id: "food",
      name_en: "Food",
      has_children: true,
      expense: 32400,
      previous_expense: 28929,
      last_year_expense: 31154,
    }),
    category({ id: "groceries", parent_id: "food", name_en: "Groceries", expense: 24100 }),
    category({ id: "market", parent_id: "food", name_en: "Market", expense: 8300 }),
    category({ id: "cafe", name_en: "Cafe", expense: 18900, previous_expense: 19895 }),
    category({ id: "salary", name_en: "Salary", income: 185000 }),
  ],
  days: [
    { date: "2026-10-01", income: 0, expense: 2100 },
    { date: "2026-10-02", income: 185000, expense: 5400 },
  ],
  merchants: [
    {
      brand_id: "b1",
      name: "Pyaterochka",
      logo_url: null,
      base_color: "#b91c1c",
      expense: 11240,
      transaction_count: 14,
    },
  ],
  fx_status: { status: "ok", missing: [] },
};

function lastUrl(): URLSearchParams {
  const calls = routerMock.replace.mock.calls;
  const url = String(calls[calls.length - 1]?.[0] ?? "");
  return new URLSearchParams(url.split("?")[1] ?? "");
}

describe("MoneyReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedPersonIdState = "person-1";
    currentSearchParams = new URLSearchParams("period=month&start=2026-10-01");
    hookMocks.useIsMobile.mockReturnValue(false);
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [
        { id: "acc-1", account_label: "T-Bank" },
        { id: "acc-2", account_label: "Cash" },
      ],
    });
    hookMocks.useMoneySpendingReport.mockReturnValue({ data: REPORT, isError: false });
  });

  it("asks for a person before anything else", () => {
    selectedPersonIdState = null;
    render(<MoneyReportsPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("asks for the period, accounts and category in the URL", () => {
    currentSearchParams = new URLSearchParams(
      "period=custom&start=2026-10-05&end=2026-10-20&accounts=acc-1&category=food",
    );
    render(<MoneyReportsPage />);
    expect(hookMocks.useMoneySpendingReport).toHaveBeenCalledWith({
      personId: "person-1",
      period: { kind: "custom", start: "2026-10-05", end: "2026-10-20" },
      currency: "RUB",
      accountIds: ["acc-1"],
      categoryId: "food",
    });
  });

  it("shows the three totals with their comparisons and the forecast", () => {
    render(<MoneyReportsPage />);
    const expense = screen.getByTestId("spending-total-expense");
    expect(within(expense).getByText("RUB 118,420")).toBeInTheDocument();
    expect(within(expense).getByText(/▲ 8% money.spendingVsPrevious/)).toHaveClass(
      "text-orange-800",
    );
    expect(within(expense).getByText(/▼ 3% money.spendingVsLastYear\(2025\)/)).toHaveClass(
      "text-teal-800",
    );
    const forecast = within(expense).getByTestId("spending-forecast");
    expect(forecast).toHaveTextContent("≈ RUB 131,000");
    expect(forecast).toHaveTextContent("money.spendingForecastDaysLeft(3)");

    const net = screen.getByTestId("spending-total-net");
    expect(within(net).getByText("+RUB 66,580")).toBeInTheDocument();
    expect(within(net).getByText(/▼ 12% money.spendingVsPrevious/)).toHaveClass("text-orange-800");
  });

  it("draws the root categories as a treemap and opens a branch on a click", () => {
    render(<MoneyReportsPage />);
    const map = screen.getByTestId("spending-treemap");
    const tiles = within(map).getAllByRole("button");
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      expect.stringContaining("Food"),
      expect.stringContaining("Cafe"),
    ]);

    fireEvent.click(tiles[0]!);
    const branch = within(screen.getByTestId("spending-treemap")).getAllByRole("button");
    expect(branch.map((tile) => tile.textContent)).toEqual([
      expect.stringContaining("Groceries"),
      expect.stringContaining("Market"),
    ]);
    fireEvent.click(screen.getByText("money.spendingAllCategories"));
    expect(within(screen.getByTestId("spending-treemap")).getAllByRole("button")).toHaveLength(2);
  });

  it("filters the report by a leaf tile", () => {
    render(<MoneyReportsPage />);
    fireEvent.click(within(screen.getByTestId("spending-treemap")).getByTitle(/^Cafe/));
    expect(lastUrl().get("category")).toBe("cafe");
  });

  it("switches the map and the table to income", () => {
    render(<MoneyReportsPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "money.spendingIncome" })[0]!);
    const tiles = within(screen.getByTestId("spending-treemap")).getAllByRole("button");
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveTextContent("Salary");
    expect(screen.getByTestId("spending-row-salary")).toBeInTheDocument();
  });

  it("lists the categories with share and comparisons, expands a branch and filters by a row", () => {
    render(<MoneyReportsPage />);
    const food = screen.getByTestId("spending-row-food");
    expect(food).toHaveTextContent("63%");
    expect(food).toHaveTextContent("▲ 12%");
    expect(food).toHaveTextContent("▲ 4%");
    expect(screen.queryByTestId("spending-row-groceries")).not.toBeInTheDocument();

    fireEvent.click(within(food).getByRole("button", { name: "money.spendingExpand(Food)" }));
    expect(screen.getByTestId("spending-row-groceries")).toBeInTheDocument();
    fireEvent.click(within(food).getByRole("button", { name: "money.spendingCollapse(Food)" }));
    expect(screen.queryByTestId("spending-row-groceries")).not.toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId("spending-row-cafe")).getByRole("button", {
        name: "money.spendingFilterByCategory(Cafe)",
      }),
    );
    expect(lastUrl().get("category")).toBe("cafe");
  });

  it("shows a category filter as a chip that clears it", () => {
    currentSearchParams = new URLSearchParams("period=month&start=2026-10-01&category=food");
    render(<MoneyReportsPage />);
    expect(screen.getByText("money.spendingFilterChip(Food)")).toBeInTheDocument();
    const tiles = within(screen.getByTestId("spending-treemap")).getAllByRole("button");
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      expect.stringContaining("Groceries"),
      expect.stringContaining("Market"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "money.spendingClearFilter" }));
    expect(lastUrl().has("category")).toBe(false);
  });

  it("moves between periods and kinds of period", () => {
    render(<MoneyReportsPage />);
    expect(screen.getByText("October 2026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "money.spendingPrevious" }));
    expect(lastUrl().get("start")).toBe("2026-09-01");
    expect(lastUrl().get("period")).toBe("month");

    fireEvent.click(screen.getByRole("button", { name: "money.spendingPeriodWeek" }));
    expect(lastUrl().get("period")).toBe("week");

    fireEvent.change(screen.getByLabelText("money.spendingCustomFrom"), {
      target: { value: "2026-10-05" },
    });
    fireEvent.change(screen.getByLabelText("money.spendingCustomTo"), {
      target: { value: "2026-10-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "money.spendingApply" }));
    expect(lastUrl().get("period")).toBe("custom");
    expect(lastUrl().get("end")).toBe("2026-10-20");
  });

  it("narrows the report to the accounts picked", () => {
    render(<MoneyReportsPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: "T-Bank" }));
    expect(lastUrl().get("accounts")).toBe("acc-1");

    currentSearchParams = new URLSearchParams("period=month&start=2026-10-01&accounts=acc-1");
    render(<MoneyReportsPage />);
    expect(screen.getByText("money.spendingAccountsCount(1)")).toBeInTheDocument();
  });

  it("shows the days and the merchants", () => {
    render(<MoneyReportsPage />);
    expect(screen.getByTestId("spending-days").children).toHaveLength(2);
    const merchants = screen.getByTestId("spending-merchants");
    expect(merchants).toHaveTextContent("Pyaterochka");
    expect(merchants).toHaveTextContent("money.spendingMerchantCount(14)");
  });

  it("says when rates are missing, and when the report failed", () => {
    hookMocks.useMoneySpendingReport.mockReturnValue({
      data: { ...REPORT, fx_status: { status: "error", missing: ["USD:2026-10-03"] } },
      isError: false,
    });
    const { unmount } = render(<MoneyReportsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("money.spendingFxMissing(USD:2026-10-03)");
    unmount();

    hookMocks.useMoneySpendingReport.mockReturnValue({ data: undefined, isError: true });
    render(<MoneyReportsPage />);
    expect(screen.getByText("money.spendingLoadFailed")).toBeInTheDocument();
  });

  it("fits the totals side by side on a phone and lists categories instead of a table", () => {
    hookMocks.useIsMobile.mockReturnValue(true);
    render(<MoneyReportsPage />);
    const expense = screen.getByTestId("spending-total-expense");
    expect(within(expense).getByText(/▲ 8% money.spendingVsPreviousShort/)).toBeInTheDocument();
    expect(within(expense).queryByTestId("spending-forecast")).not.toBeInTheDocument();
    expect(screen.getByTestId("spending-forecast")).toHaveTextContent("≈ RUB 131,000");

    const food = screen.getByTestId("spending-row-food");
    expect(food).toHaveTextContent("63%");
    fireEvent.click(within(food).getByRole("button", { name: "money.spendingExpand(Food)" }));
    expect(food).toHaveTextContent("Groceries");
    fireEvent.click(
      within(food).getByRole("button", { name: "money.spendingFilterByCategory(Food)" }),
    );
    expect(lastUrl().get("category")).toBe("food");
  });

  it("says so when the period has nothing in it", () => {
    hookMocks.useMoneySpendingReport.mockReturnValue({
      data: { ...REPORT, categories: [], merchants: [], forecast: null },
      isError: false,
    });
    render(<MoneyReportsPage />);
    expect(screen.getByText("money.spendingEmpty")).toBeInTheDocument();
    expect(screen.queryByTestId("spending-forecast")).not.toBeInTheDocument();
  });
});
