import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyBudgetReport } from "@/types";
import MoneyReportsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useIsMobile: vi.fn(),
  useMoneyBudgetReport: vi.fn(),
  useMoneyTransferSelfAliases: vi.fn(),
  useUpsertMoneyBudgetTarget: vi.fn(),
  useDeleteMoneyBudgetTarget: vi.fn(),
  useCreateMoneyTransferSelfAlias: vi.fn(),
  useDeleteMoneyTransferSelfAlias: vi.fn(),
}));

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

let selectedPersonIdState: string | null = "person-1";
let currentSearchParams = new URLSearchParams();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  useMoneyBudgetReport: (...args: unknown[]) => hookMocks.useMoneyBudgetReport(...args),
  useMoneyTransferSelfAliases: (...args: unknown[]) =>
    hookMocks.useMoneyTransferSelfAliases(...args),
  useUpsertMoneyBudgetTarget: (...args: unknown[]) => hookMocks.useUpsertMoneyBudgetTarget(...args),
  useDeleteMoneyBudgetTarget: (...args: unknown[]) => hookMocks.useDeleteMoneyBudgetTarget(...args),
  useCreateMoneyTransferSelfAlias: (...args: unknown[]) =>
    hookMocks.useCreateMoneyTransferSelfAlias(...args),
  useDeleteMoneyTransferSelfAlias: (...args: unknown[]) =>
    hookMocks.useDeleteMoneyTransferSelfAlias(...args),
}));

vi.mock("@/lib/date-locale", () => ({
  useIntlLocale: () => "en-US",
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({
    children,
    data,
  }: {
    children: React.ReactNode;
    data?: Array<Record<string, unknown>>;
  }) => (
    <div data-testid="mock-bar-chart" data-chart={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  ReferenceLine: () => <div />,
}));

vi.mock("@/components/ui/popover", () => {
  const PopoverContext = React.createContext<{
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }>({ open: false });

  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <PopoverContext.Provider value={{ open: Boolean(open), onOpenChange }}>
        {children}
      </PopoverContext.Provider>
    ),
    PopoverTrigger: ({ children }: { children: React.ReactElement<{ onClick?: () => void }> }) => {
      const { open, onOpenChange } = React.useContext(PopoverContext);
      return React.cloneElement(children, {
        onClick: () => {
          children.props.onClick?.();
          onOpenChange?.(!open);
        },
      });
    },
    PopoverContent: ({ children }: { children: React.ReactNode }) => {
      const { open } = React.useContext(PopoverContext);
      return open ? <div>{children}</div> : null;
    },
    PopoverAnchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="dialog-root" data-open={open ? "true" : "false"}>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        close-dialog
      </button>
      {open ? children : null}
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="sheet-root" data-open={open ? "true" : "false"}>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        close-sheet
      </button>
      {open ? children : null}
    </div>
  ),
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

function makeBaseReport(): MoneyBudgetReport {
  return {
    month_start: "2026-03-01",
    currency: "RUB",
    summary: {
      actual_income: 1000,
      actual_expenses: -450,
      actual_net: 550,
      target_income: 1200,
      target_expenses: -600,
      target_net: 600,
      variance_net: -50,
    },
    fx_status: {
      mode: "ok",
      approximated_dates: [],
      missing_pairs: [],
      message: null,
      is_blocking: false,
    },
    trend: [
      { date: "2026-03-01", income: 1000, expenses: -100, net: 900 },
      { date: "2026-03-02", income: 0, expenses: -350, net: -350 },
    ],
    categories: [
      {
        id: "food",
        parent_id: null,
        canonical_category_id: "food",
        depth: 1,
        name_en: "Food",
        name_ru: "Food RU",
        slug: "food",
        archived_at: null,
        is_uncategorized: false,
        actual_income: 0,
        actual_expenses: -450,
        actual_net: -450,
        target_amount: -500,
        variance_amount: 50,
        target: {
          id: "target-food",
          person_id: "person-1",
          category_id: "food",
          month_start: "2026-03-01",
          target_amount: -500,
          currency: "RUB",
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
        children: [
          {
            id: "coffee",
            parent_id: "food",
            canonical_category_id: "food",
            depth: 2,
            name_en: "Coffee",
            name_ru: "Coffee RU",
            slug: "coffee",
            archived_at: null,
            is_uncategorized: false,
            actual_income: 0,
            actual_expenses: -120,
            actual_net: -120,
            target_amount: 0,
            variance_amount: -120,
            target: null,
            children: [],
          },
        ],
      },
    ],
  };
}

type ReportShape = ReturnType<typeof makeBaseReport>;

function makeReport(overrides: Partial<ReportShape> = {}): ReportShape {
  const base = makeBaseReport();
  return {
    ...base,
    ...overrides,
    summary: {
      ...base.summary,
      ...(overrides.summary ?? {}),
    },
    fx_status: {
      ...base.fx_status,
      ...(overrides.fx_status ?? {}),
    },
    trend: overrides.trend ?? base.trend,
    categories: overrides.categories ?? base.categories,
  };
}

const RealDate = Date;

class MockDate extends Date {
  constructor(value?: string | number | Date) {
    if (value === undefined) {
      super("2026-03-13T12:00:00.000Z");
      return;
    }
    super(value);
  }

  static now() {
    return new RealDate("2026-03-13T12:00:00.000Z").valueOf();
  }
}

Object.defineProperty(MockDate, "parse", { value: RealDate.parse });
Object.defineProperty(MockDate, "UTC", { value: RealDate.UTC });

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("MoneyReportsPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal("Date", MockDate);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    selectedPersonIdState = "person-1";
    currentSearchParams = new URLSearchParams();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);
    toastMock.error.mockReset();
    toastMock.success.mockReset();

    hookMocks.useIsMobile.mockReturnValue(false);
    hookMocks.useMoneyBudgetReport.mockReturnValue({
      data: makeReport(),
      isLoading: false,
      error: null,
    });
    hookMocks.useMoneyTransferSelfAliases.mockReturnValue({ data: [], isLoading: false });
    hookMocks.useUpsertMoneyBudgetTarget.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
    hookMocks.useDeleteMoneyBudgetTarget.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
    hookMocks.useCreateMoneyTransferSelfAlias.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
    hookMocks.useDeleteMoneyTransferSelfAlias.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
  });

  it("renders person prompt when no person is selected", () => {
    selectedPersonIdState = null;

    render(<MoneyReportsPage />);

    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("syncs default month and currency into the URL", async () => {
    render(<MoneyReportsPage />);
    await flushEffects();

    expect(routerMock.replace).toHaveBeenCalledWith("/money/reports?month=2026-03&currency=RUB", {
      scroll: false,
    });
  });

  it("does not rewrite the URL when valid month and currency are already present", async () => {
    currentSearchParams = new URLSearchParams("month=2026-03&currency=RUB");

    render(<MoneyReportsPage />);
    await flushEffects();

    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("renders loading skeletons while the report query is pending", () => {
    hookMocks.useMoneyBudgetReport.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    const view = render(<MoneyReportsPage />);

    expect(view.container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(4);
  });

  it("renders the load error state when the report query fails", async () => {
    hookMocks.useMoneyBudgetReport.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("budget rpc failed"),
    });

    render(<MoneyReportsPage />);
    await flushEffects();

    expect(screen.getAllByText("money.reportLoadFailed")[0]).toBeInTheDocument();
    expect(screen.getByText("budget rpc failed")).toBeInTheDocument();
  });

  it("renders approximate FX warning while keeping the report visible", async () => {
    hookMocks.useMoneyBudgetReport.mockReturnValue({
      data: makeReport({
        fx_status: {
          mode: "approximate",
          approximated_dates: ["2026-03-02"],
          missing_pairs: [],
          message: "Approximate FX",
          is_blocking: false,
        },
      }),
      isLoading: false,
      error: null,
    });

    render(<MoneyReportsPage />);
    await flushEffects();

    expect(screen.getByText("money.reportFxApproximateTitle")).toBeInTheDocument();
    expect(screen.getByText("Approximate FX")).toBeInTheDocument();
    expect(screen.getByTestId("budget-trend-chart")).toBeInTheDocument();
  });

  it("renders blocking FX warning and hides charts when conversions are missing", async () => {
    hookMocks.useMoneyBudgetReport.mockReturnValue({
      data: makeReport({
        fx_status: {
          mode: "missing",
          approximated_dates: [],
          missing_pairs: ["USD:2026-03-01"],
          message: "Missing FX",
          is_blocking: true,
        },
      }),
      isLoading: false,
      error: null,
    });

    render(<MoneyReportsPage />);
    await flushEffects();

    expect(screen.getByText("money.reportFxMissingTitle")).toBeInTheDocument();
    expect(screen.getByText("Missing FX")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-trend-chart")).not.toBeInTheDocument();
  });

  it("renders budget report content and focuses a category from the chart legend", async () => {
    render(<MoneyReportsPage />);
    await flushEffects();

    expect(
      screen.getByRole("heading", { level: 1, name: "money.budgetReportTitle" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("budget-trend-chart")).toBeInTheDocument();
    expect(screen.getByTestId("budget-donut-chart")).toBeInTheDocument();
    expect(screen.getByTestId("budget-root-comparison-chart")).toBeInTheDocument();
    expect(screen.getByTestId("budget-row-food")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-row-coffee")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /Food/ }));

    expect(screen.getByTestId("budget-row-food").className).toContain("bg-secondary/80");
  });

  it("expands nested desktop categories when the tree toggle is clicked", async () => {
    render(<MoneyReportsPage />);
    await flushEffects();

    expect(screen.queryByTestId("budget-row-coffee")).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByTestId("budget-row-food").querySelector("button") as HTMLButtonElement);

    expect(screen.getByTestId("budget-row-coffee")).toBeInTheDocument();
  });

  it("opens the target editor and saves a target", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    hookMocks.useUpsertMoneyBudgetTarget.mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    render(<MoneyReportsPage />);
    await flushEffects();
    fireEvent.click(screen.getAllByRole("button", { name: "money.reportEditTarget" })[0]!);
    const amountInput = screen.getByPlaceholderText("0");
    fireEvent.change(amountInput, { target: { value: "550" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        personId: "person-1",
        categoryId: "food",
        monthStart: "2026-03-01",
        targetAmount: -550,
        currency: "RUB",
      });
    });
  });

  it("deletes an existing target from the mobile sheet editor", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    hookMocks.useIsMobile.mockReturnValue(true);
    hookMocks.useDeleteMoneyBudgetTarget.mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    render(<MoneyReportsPage />);
    await flushEffects();

    const buttons = screen.getByTestId("budget-row-food").querySelectorAll("button");
    await userEvent.setup().click(buttons[1] as HTMLButtonElement);
    await userEvent.setup().click(screen.getByRole("button", { name: "common.delete" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        personId: "person-1",
        categoryId: "food",
        monthStart: "2026-03-01",
      });
    });
    expect(toastMock.success).toHaveBeenCalledWith("money.reportTargetDeleted");
  });

  it("validates target amounts before saving", async () => {
    render(<MoneyReportsPage />);
    await flushEffects();

    fireEvent.click(screen.getAllByRole("button", { name: "money.reportEditTarget" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    expect(toastMock.error).toHaveBeenCalledWith("money.reportTargetValidation");
  });

  it("shows mutation error messages for failed target saves", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("save failed"));
    hookMocks.useUpsertMoneyBudgetTarget.mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    render(<MoneyReportsPage />);
    await flushEffects();

    fireEvent.click(screen.getAllByRole("button", { name: "money.reportEditTarget" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "550" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("save failed");
    });
  });

  it("keeps the desktop target editor focused while typing", async () => {
    render(<MoneyReportsPage />);
    await flushEffects();

    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: "money.reportEditTarget" })[0]!);

    const amountInput = screen.getByPlaceholderText("0");
    await user.clear(amountInput);
    await user.type(amountInput, "1200");

    const updatedInput = screen.getByPlaceholderText("0");
    expect(updatedInput).toHaveValue("1200");
    expect(updatedInput).toHaveFocus();
  });

  it("uses positive target magnitudes in the net comparison chart", async () => {
    render(<MoneyReportsPage />);
    await flushEffects();

    await userEvent.setup().click(screen.getByRole("button", { name: "money.reportChartModeNet" }));

    const chartData = JSON.parse(
      screen.getByTestId("mock-bar-chart").getAttribute("data-chart") ?? "[]",
    ) as Array<{
      id: string;
      actual: number;
      target: number;
    }>;

    expect(chartData).toEqual([
      expect.objectContaining({
        id: "food",
        actual: 450,
        target: 500,
      }),
    ]);
  });

  it("shows the empty chart hint when every root category is zeroed out", async () => {
    const base = makeReport();
    hookMocks.useMoneyBudgetReport.mockReturnValue({
      data: makeReport({
        categories: [
          {
            ...base.categories[0],
            actual_income: 0,
            actual_expenses: 0,
            actual_net: 0,
            target_amount: 0,
            variance_amount: 0,
            target: null,
            children: [],
          },
        ],
      }),
      isLoading: false,
      error: null,
    });

    render(<MoneyReportsPage />);
    await flushEffects();

    expect(screen.getByText("money.reportChartEmpty")).toBeInTheDocument();
  });

  it("updates the selected month when navigation buttons are clicked", async () => {
    currentSearchParams = new URLSearchParams("month=2026-03&currency=RUB");

    render(<MoneyReportsPage />);
    await flushEffects();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "money.reportPreviousMonth" }));

    expect(routerMock.replace).toHaveBeenLastCalledWith(
      "/money/reports?month=2026-02&currency=RUB",
      { scroll: false },
    );
  });

  it("creates self-transfer aliases from the dialog", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    hookMocks.useCreateMoneyTransferSelfAlias.mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    render(<MoneyReportsPage />);
    await flushEffects();
    fireEvent.click(screen.getByRole("button", { name: "money.reportSelfAliases" }));
    fireEvent.change(screen.getByPlaceholderText("money.reportAliasPlaceholder"), {
      target: { value: "Savings alias" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        personId: "person-1",
        alias: "Savings alias",
      });
    });
  });

  it("shows empty aliases state and validates blank alias submissions", async () => {
    hookMocks.useMoneyTransferSelfAliases.mockReturnValue({ data: [], isLoading: false });

    render(<MoneyReportsPage />);
    await flushEffects();

    fireEvent.click(screen.getByRole("button", { name: "money.reportSelfAliases" }));
    expect(screen.getByText("money.reportAliasesEmpty")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "common.add" }));
    expect(toastMock.error).toHaveBeenCalledWith("money.reportAliasValidation");
  });

  it("deletes aliases and reports alias mutation failures", async () => {
    const deleteMutateAsync = vi.fn().mockRejectedValue(new Error("delete alias failed"));
    const createMutateAsync = vi.fn().mockRejectedValue(new Error("save alias failed"));
    hookMocks.useMoneyTransferSelfAliases.mockReturnValue({
      data: [
        {
          id: "alias-1",
          person_id: "person-1",
          alias: "Own transfer",
          normalized_alias: "owntransfer",
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
    });
    hookMocks.useDeleteMoneyTransferSelfAlias.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
    hookMocks.useCreateMoneyTransferSelfAlias.mockReturnValue({
      mutateAsync: createMutateAsync,
      isPending: false,
    });

    render(<MoneyReportsPage />);
    await flushEffects();

    fireEvent.click(screen.getByRole("button", { name: "money.reportSelfAliases" }));
    fireEvent.change(screen.getByPlaceholderText("money.reportAliasPlaceholder"), {
      target: { value: "Alias failure" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("save alias failed");
    });

    const aliasRow = screen.getByText("Own transfer").closest("div")?.parentElement;
    fireEvent.click(aliasRow?.querySelector("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith("alias-1");
    });
    expect(toastMock.error).toHaveBeenCalledWith("delete alias failed");
  });
});
