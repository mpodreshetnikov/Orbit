import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoneyTransactionsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useIsMobile: vi.fn(),
  useMoneyAccounts: vi.fn(),
  useMoneyCategories: vi.fn(),
  useInfiniteMoneyTransactionFeed: vi.fn(),
  useMoneyTransactionFeedSummary: vi.fn(),
  useMoneyTransaction: vi.fn(),
}));

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
}));

let selectedPersonIdState: string | null = "person-1";
let currentSearchParams = new URLSearchParams();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/money/transactions",
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  useIsMobile: (...args: unknown[]) => hookMocks.useIsMobile(...args),
  useMoneyAccounts: (...args: unknown[]) => hookMocks.useMoneyAccounts(...args),
  useMoneyCategories: (...args: unknown[]) => hookMocks.useMoneyCategories(...args),
  useInfiniteMoneyTransactionFeed: (...args: unknown[]) =>
    hookMocks.useInfiniteMoneyTransactionFeed(...args),
  useMoneyTransactionFeedSummary: (...args: unknown[]) =>
    hookMocks.useMoneyTransactionFeedSummary(...args),
  useMoneyTransaction: (...args: unknown[]) => hookMocks.useMoneyTransaction(...args),
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
  useIntlLocale: () => "en-US",
}));

function makeAccounts() {
  return [
    {
      id: "acc-1",
      account_label: "Main card",
      is_active: true,
      currency: "RUB",
    },
    {
      id: "acc-2",
      account_label: "Travel cash",
      is_active: true,
      currency: "RUB",
    },
  ];
}

function makeCategories() {
  return [
    {
      id: "cat-food",
      name_en: "Food",
      name_ru: "Еда",
      depth: 1,
    },
  ];
}

function makeFeedRows() {
  return [
    {
      id: "tx-1",
      payer_person_id: "person-1",
      account_id: "acc-1",
      posted_at: "2026-01-03T10:00:00.000Z",
      amount: -1200,
      currency: "RUB",
      transaction_type: "expense",
      status: "posted",
      merchant_name: "Pharmacy",
      operation_icon_url: "https://cdn.example.com/pharmacy.png",
      comment: "Canonical order",
      source_comment: "Imported order note",
      is_transfer: false,
      money_cards: { id: "card-1", last4: "1234", card_label: "Blue" },
      money_transaction_brands: null,
      line_item_titles: ["Milk", "Vitamin C"],
      category_ids: ["cat-food"],
      line_item_count: 2,
    },
    {
      id: "tx-2",
      payer_person_id: "person-1",
      account_id: "acc-2",
      posted_at: "2026-01-02T10:00:00.000Z",
      amount: 800,
      currency: "RUB",
      transaction_type: "income",
      status: "pending",
      merchant_name: null,
      comment: null,
      source_comment: "Imported salary note",
      is_transfer: false,
      money_cards: null,
      money_transaction_brands: null,
      line_item_titles: ["Salary"],
      category_ids: [],
      line_item_count: 1,
    },
  ];
}

function openFilterPanel(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: /common\.filter/i }));
}

describe("MoneyTransactionsPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    currentSearchParams = new URLSearchParams();

    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    hookMocks.useIsMobile.mockReturnValue(false);
    hookMocks.useMoneyAccounts.mockReturnValue({ data: makeAccounts() });
    hookMocks.useMoneyCategories.mockReturnValue({ data: makeCategories() });
    hookMocks.useInfiniteMoneyTransactionFeed.mockReturnValue({
      data: {
        pages: [
          {
            items: makeFeedRows(),
          },
        ],
      },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });
    hookMocks.useMoneyTransactionFeedSummary.mockReturnValue({
      data: {
        totalCount: 2,
        totalPositiveAmount: 800,
        totalNegativeAmount: -1200,
      },
      isLoading: false,
    });
    hookMocks.useMoneyTransaction.mockReturnValue({
      data: {
        id: "tx-1",
        payer_person_id: "person-1",
        account_id: "acc-1",
        posted_at: "2026-01-03T10:00:00.000Z",
        amount: -1200,
        currency: "RUB",
        transaction_type: "expense",
        status: "posted",
        merchant_name: "Pharmacy",
        comment: "Canonical order",
        source_comment: "Imported order note",
        line_items: [
          {
            id: "line-1",
            title: "Milk",
            amount: 500,
            category_id: "cat-food",
            category_locked_by_user: false,
          },
        ],
        money_cards: { id: "card-1", last4: "1234", card_label: "Blue" },
        money_transaction_brands: null,
      },
      isLoading: false,
    });
  });

  it("renders person prompt when no person is selected", () => {
    selectedPersonIdState = null;

    render(<MoneyTransactionsPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("hydrates URL-synced filters into the hidden filter panel", async () => {
    currentSearchParams = new URLSearchParams(
      "q=milk&accounts=acc-1&types=expense&statuses=posted&categories=cat-food&transfer=exclude&sign=expense&preset=30d",
    );

    render(<MoneyTransactionsPage />);

    await waitFor(() => {
      expect(hookMocks.useInfiniteMoneyTransactionFeed).toHaveBeenCalledWith(
        "person-1",
        expect.objectContaining({
          query: "milk",
          accountIds: ["acc-1"],
          transactionTypes: ["expense"],
          statuses: ["posted"],
          categoryIds: ["cat-food"],
          transferFilter: "exclude",
          amountSign: "expense",
        }),
      );
    });

    expect(screen.getByDisplayValue("milk")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Main card" })).not.toBeInTheDocument();
    expect(screen.getByText("money.summaryPositive")).toBeInTheDocument();
    expect(screen.getByText("money.summaryNegative")).toBeInTheDocument();

    const user = userEvent.setup();
    await openFilterPanel(user);

    expect(screen.getByText("money.filterAccounts")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Main card" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Food/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "money.transactionTypeExpense" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "money.transactionStatusPosted" })).toBeChecked();
    expect(screen.getByRole("button", { name: "money.datePreset30d" })).toBeInTheDocument();
  });

  it("applies draft filters from the hidden panel in one URL update", async () => {
    render(<MoneyTransactionsPage />);

    const user = userEvent.setup();
    await openFilterPanel(user);

    await user.click(screen.getByRole("checkbox", { name: "Main card" }));
    await user.click(screen.getByRole("checkbox", { name: "money.transactionTypeExpense" }));
    await user.click(screen.getByRole("checkbox", { name: "money.transactionStatusPosted" }));
    await user.click(screen.getByRole("button", { name: "money.transferFilterExclude" }));
    await user.click(screen.getByRole("button", { name: "money.amountSignExpense" }));
    await user.click(screen.getByRole("button", { name: "money.datePreset7d" }));
    await user.click(screen.getByRole("button", { name: "common.apply" }));

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith(
        expect.stringContaining("/money/transactions?"),
        { scroll: false },
      );
    });

    const lastUrl = String(routerMock.replace.mock.lastCall?.[0] ?? "");
    expect(lastUrl).toContain("accounts=acc-1");
    expect(lastUrl).toContain("types=expense");
    expect(lastUrl).toContain("statuses=posted");
    expect(lastUrl).toContain("transfer=exclude");
    expect(lastUrl).toContain("sign=expense");
    expect(lastUrl).toContain("preset=7d");
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });

  it("clears structured filters without clearing search", async () => {
    currentSearchParams = new URLSearchParams(
      "q=milk&accounts=acc-1&types=expense&statuses=posted&transfer=exclude&sign=expense&preset=30d",
    );

    render(<MoneyTransactionsPage />);

    const user = userEvent.setup();
    await openFilterPanel(user);
    await user.click(screen.getByRole("button", { name: "common.clear" }));

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith(
        expect.stringContaining("/money/transactions?"),
        { scroll: false },
      );
    });

    const lastUrl = String(routerMock.replace.mock.lastCall?.[0] ?? "");
    expect(lastUrl).toContain("q=milk");
    expect(lastUrl).not.toContain("accounts=");
    expect(lastUrl).not.toContain("types=");
    expect(lastUrl).not.toContain("statuses=");
    expect(lastUrl).not.toContain("transfer=");
    expect(lastUrl).not.toContain("sign=");
    expect(lastUrl).not.toContain("preset=");
  });

  it("opens transaction detail in-place from the ledger feed without clearing search and filters", async () => {
    currentSearchParams = new URLSearchParams("q=pharm&accounts=acc-1");

    render(<MoneyTransactionsPage />);

    expect(screen.getByDisplayValue("pharm")).toBeInTheDocument();
    expect(screen.getByText("Pharmacy")).toBeInTheDocument();
    expect(screen.getByText(/Food/)).toBeInTheDocument();
    expect(screen.getAllByText("Main card").length).toBeGreaterThan(0);
    expect(screen.getByText("Canonical order")).toBeInTheDocument();
    expect(screen.getByText("Milk, Vitamin C")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Pharmacy" }));

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith(expect.stringContaining("tx=tx-1"), {
        scroll: false,
      });
    });

    expect(screen.getByDisplayValue("pharm")).toBeInTheDocument();
    const lastUrl = String(routerMock.replace.mock.lastCall?.[0] ?? "");
    expect(lastUrl).toContain("accounts=acc-1");
    expect(lastUrl).toContain("q=pharm");
  });

  it("shows a single preferred comment per transaction card", () => {
    render(<MoneyTransactionsPage />);

    expect(screen.getByText("Canonical order")).toBeInTheDocument();
    expect(screen.queryByText("Imported order note")).not.toBeInTheDocument();
    expect(screen.getByText("Imported salary note")).toBeInTheDocument();
  });

  it("renders stored transaction icons when the feed row has an operation icon url", () => {
    const { container } = render(<MoneyTransactionsPage />);

    const transactionIcon = container.querySelector(
      'img[src="https://cdn.example.com/pharmacy.png"]',
    );

    expect(transactionIcon).toBeInTheDocument();
  });

  it("shows the selected categories above the category search list", async () => {
    currentSearchParams = new URLSearchParams("categories=cat-food");

    render(<MoneyTransactionsPage />);

    const user = userEvent.setup();
    await openFilterPanel(user);

    expect(screen.getByRole("button", { name: /Food/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Food/i })).toBeChecked();
  });

  it("renders an accessible title inside the mobile filters sheet", async () => {
    hookMocks.useIsMobile.mockReturnValue(true);

    render(<MoneyTransactionsPage />);

    const user = userEvent.setup();
    await openFilterPanel(user);

    expect(screen.getAllByText("money.filtersTitle").length).toBeGreaterThan(0);
    expect(screen.getAllByText("money.filtersHint").length).toBeGreaterThan(0);
  });

  it("collapses the filter summary when the transactions list starts scrolling", () => {
    currentSearchParams = new URLSearchParams("accounts=acc-1");

    render(<MoneyTransactionsPage />);

    const summary = screen.getByTestId("transaction-search-summary");
    const list = screen.getByTestId("transaction-list");

    expect(summary).toHaveAttribute("data-collapsed", "false");

    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      value: 48,
      writable: true,
    });

    fireEvent.scroll(list);

    expect(summary).toHaveAttribute("data-collapsed", "true");
  });

  it("renders loading skeletons while the feed is loading", () => {
    hookMocks.useInfiniteMoneyTransactionFeed.mockReturnValue({
      data: undefined,
      isLoading: true,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });

    const { container } = render(<MoneyTransactionsPage />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(6);
    expect(screen.queryByTestId("transaction-list")).not.toBeInTheDocument();
  });

  it("renders empty state when the feed has no transactions", () => {
    hookMocks.useInfiniteMoneyTransactionFeed.mockReturnValue({
      data: { pages: [{ items: [] }] },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });

    render(<MoneyTransactionsPage />);

    expect(screen.getByText("money.noTransactions")).toBeInTheDocument();
    expect(screen.getByText("money.noTransactionsHint")).toBeInTheDocument();
  });

  it("applies custom date filters and clears them when switching back to a preset", async () => {
    const firstRender = render(<MoneyTransactionsPage />);

    let user = userEvent.setup();
    await openFilterPanel(user);

    await user.click(screen.getByRole("button", { name: "money.datePresetcustom" }));
    fireEvent.change(screen.getByLabelText("money.filterFromDate"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("money.filterToDate"), {
      target: { value: "2026-01-31" },
    });
    await user.click(screen.getByRole("button", { name: "common.apply" }));

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
    let lastUrl = String(routerMock.replace.mock.lastCall?.[0] ?? "");
    expect(lastUrl).toContain("preset=custom");
    expect(lastUrl).toContain("from=2026-01-01T00%3A00%3A00.000Z");
    expect(lastUrl).toContain("to=2026-01-31T23%3A59%3A59.999Z");

    currentSearchParams = new URLSearchParams(lastUrl.split("?")[1] ?? "");
    routerMock.replace.mockClear();
    firstRender.unmount();

    render(<MoneyTransactionsPage />);
    user = userEvent.setup();
    await openFilterPanel(user);
    await user.click(screen.getByRole("button", { name: "money.datePreset7d" }));
    await user.click(screen.getByRole("button", { name: "common.apply" }));

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
    lastUrl = String(routerMock.replace.mock.lastCall?.[0] ?? "");
    expect(lastUrl).toContain("preset=7d");
    expect(lastUrl).not.toContain("from=");
    expect(lastUrl).not.toContain("to=");
  });

  it.each([
    ["7d", "2026-02-08T12:00:00.000Z", "2026-02-15T12:00:00.000Z"],
    ["3m", "2025-11-15T12:00:00.000Z", "2026-02-15T12:00:00.000Z"],
    ["1y", "2025-02-15T12:00:00.000Z", "2026-02-15T12:00:00.000Z"],
  ])("hydrates %s date presets into feed filters", (preset, expectedFrom, expectedTo) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-15T12:00:00.000Z"));
      currentSearchParams = new URLSearchParams(`preset=${preset}`);

      render(<MoneyTransactionsPage />);

      expect(hookMocks.useInfiniteMoneyTransactionFeed).toHaveBeenCalledWith(
        "person-1",
        expect.objectContaining({
          preset,
          from: expectedFrom,
          to: expectedTo,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no-results search states and removes selected account and category filters", async () => {
    currentSearchParams = new URLSearchParams("accounts=acc-1&categories=cat-food");

    render(<MoneyTransactionsPage />);

    const user = userEvent.setup();
    await openFilterPanel(user);

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1]!, { target: { value: "missing-account" } });
    fireEvent.change(inputs[2]!, { target: { value: "missing-category" } });
    expect(screen.getAllByText("common.noResults").length).toBeGreaterThanOrEqual(2);

    fireEvent.change(inputs[1]!, { target: { value: "" } });
    fireEvent.change(inputs[2]!, { target: { value: "" } });
    await user.click(screen.getByRole("checkbox", { name: "Main card" }));
    await user.click(screen.getByRole("button", { name: /Food/i }));
    await user.click(screen.getByRole("button", { name: "common.apply" }));

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
    const lastUrl = String(routerMock.replace.mock.lastCall?.[0] ?? "");
    expect(lastUrl).not.toContain("accounts=");
    expect(lastUrl).not.toContain("categories=");
  });

  it("renders fallback row content for unmapped categories, accounts, comments, and extra transaction types", () => {
    hookMocks.useMoneyAccounts.mockReturnValue({ data: [] });
    hookMocks.useMoneyCategories.mockReturnValue({ data: [] });
    hookMocks.useInfiniteMoneyTransactionFeed.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              {
                id: "tx-transfer",
                payer_person_id: "person-1",
                account_id: "missing-account",
                posted_at: "2026-01-03T10:00:00.000Z",
                amount: -50,
                currency: "RUB",
                transaction_type: "transfer",
                status: "posted",
                merchant_name: "Transfer item",
                operation_icon_url: null,
                comment: "   ",
                source_comment: "   ",
                money_cards: null,
                line_item_titles: [],
                category_ids: [],
              },
              {
                id: "tx-refund",
                payer_person_id: "person-1",
                account_id: "missing-account",
                posted_at: "2026-01-03T09:00:00.000Z",
                amount: 25,
                currency: "RUB",
                transaction_type: "refund",
                status: "posted",
                merchant_name: "Refund item",
                operation_icon_url: null,
                comment: null,
                source_comment: null,
                money_cards: null,
                line_item_titles: [],
                category_ids: ["missing-category"],
              },
              {
                id: "tx-fee",
                payer_person_id: "person-1",
                account_id: "missing-account",
                posted_at: "2026-01-03T08:00:00.000Z",
                amount: -10,
                currency: "RUB",
                transaction_type: "fee",
                status: "posted",
                merchant_name: "Fee item",
                operation_icon_url: null,
                comment: null,
                source_comment: null,
                money_cards: null,
                line_item_titles: [],
                category_ids: [],
              },
              {
                id: "tx-adjustment",
                payer_person_id: "person-1",
                account_id: "missing-account",
                posted_at: "2026-01-03T07:00:00.000Z",
                amount: 5,
                currency: "RUB",
                transaction_type: "adjustment",
                status: "posted",
                merchant_name: "Adjustment item",
                operation_icon_url: null,
                comment: null,
                source_comment: null,
                money_cards: null,
                line_item_titles: [],
                category_ids: [],
              },
              {
                id: "tx-unknown",
                payer_person_id: "person-1",
                account_id: "missing-account",
                posted_at: "2026-01-03T06:00:00.000Z",
                amount: 1,
                currency: "RUB",
                transaction_type: "mystery",
                status: "posted",
                merchant_name: null,
                operation_icon_url: null,
                comment: null,
                source_comment: null,
                money_cards: null,
                line_item_titles: [],
                category_ids: [],
              },
            ],
          },
        ],
      },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });

    render(<MoneyTransactionsPage />);

    expect(screen.getByRole("button", { name: "Transfer item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refund item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fee item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adjustment item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "money.transactionFallback" })).toBeInTheDocument();
    expect(screen.getAllByText("money.categoryUnassigned").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("missing-category")).toBeInTheDocument();
  });

  it("opens transaction detail fallback states and closes back to the base pathname", async () => {
    currentSearchParams = new URLSearchParams("tx=tx-2");
    hookMocks.useMoneyTransaction.mockReturnValue({
      data: {
        id: "tx-2",
        payer_person_id: "person-1",
        account_id: "acc-1",
        posted_at: "2026-01-02T10:00:00.000Z",
        amount: 800,
        currency: "RUB",
        transaction_type: "income",
        status: "pending",
        merchant_name: null,
        comment: null,
        source_comment: null,
        line_items: [
          {
            id: null,
            title: "Loose line",
            amount: 800,
            category_id: null,
            category_locked_by_user: false,
          },
        ],
        money_cards: null,
        money_transaction_brands: null,
      },
      isLoading: false,
    });

    render(<MoneyTransactionsPage />);

    expect(screen.getAllByText("money.transactionFallback").length).toBeGreaterThan(0);
    expect(screen.getByText("Loose line")).toBeInTheDocument();
    expect(screen.getAllByText("money.categoryUnassigned").length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "common.close" }));

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith("/money/transactions", { scroll: false });
    });
  });

  it("shows transaction detail loading placeholder when the selected transaction has not loaded yet", () => {
    currentSearchParams = new URLSearchParams("tx=tx-1");
    hookMocks.useMoneyTransaction.mockReturnValue({
      data: null,
      isLoading: true,
    });

    render(<MoneyTransactionsPage />);

    expect(screen.getAllByText("common.loading").length).toBeGreaterThan(0);
  });

  it("shows the pagination loader without fetching another page while one is already in flight", () => {
    const fetchNextPage = vi.fn();
    hookMocks.useInfiniteMoneyTransactionFeed.mockReturnValue({
      data: {
        pages: [
          {
            items: makeFeedRows(),
          },
        ],
      },
      isLoading: false,
      hasNextPage: true,
      fetchNextPage,
      isFetchingNextPage: true,
    });

    render(<MoneyTransactionsPage />);

    expect(screen.getAllByText("common.loading").length).toBeGreaterThan(0);

    const list = screen.getByTestId("transaction-list");
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      value: 120,
      writable: true,
    });

    fireEvent.scroll(list);

    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("requests the next feed page when scrolling near the bottom and another page is available", () => {
    const fetchNextPage = vi.fn();
    hookMocks.useInfiniteMoneyTransactionFeed.mockReturnValue({
      data: {
        pages: [
          {
            items: makeFeedRows(),
          },
        ],
      },
      isLoading: false,
      hasNextPage: true,
      fetchNextPage,
      isFetchingNextPage: false,
    });

    render(<MoneyTransactionsPage />);

    const list = screen.getByTestId("transaction-list");
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      value: 120,
      writable: true,
    });

    fireEvent.scroll(list);

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("shows the active filter count on the mobile filter button", async () => {
    hookMocks.useIsMobile.mockReturnValue(true);
    currentSearchParams = new URLSearchParams("accounts=acc-1&types=expense");

    render(<MoneyTransactionsPage />);

    const filterButton = screen.getByRole("button", { name: "common.filter" });
    expect(within(filterButton).getByText("2")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(filterButton);
    expect(screen.getAllByText("money.filtersTitle").length).toBeGreaterThan(0);
  });

  it("does not rewrite the URL when the debounced search already matches the query string", () => {
    vi.useFakeTimers();
    try {
      currentSearchParams = new URLSearchParams("q=milk");

      render(<MoneyTransactionsPage />);
      vi.advanceTimersByTime(300);

      expect(screen.getByDisplayValue("milk")).toBeInTheDocument();
      expect(routerMock.replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders fallback chips and zeroed summary values when account and category metadata are unavailable", async () => {
    currentSearchParams = new URLSearchParams("accounts=ghost-account&categories=ghost-category");
    hookMocks.useMoneyAccounts.mockReturnValue({ data: null });
    hookMocks.useMoneyCategories.mockReturnValue({ data: null });
    hookMocks.useMoneyTransactionFeedSummary.mockReturnValue({
      data: null,
      isLoading: false,
    });

    render(<MoneyTransactionsPage />);

    expect(screen.getByText("ghost-account")).toBeInTheDocument();
    expect(screen.getByText("ghost-category")).toBeInTheDocument();
    expect(screen.getByText("money.summaryMatches")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await openFilterPanel(user);
    expect(screen.getAllByText("common.noResults").length).toBeGreaterThanOrEqual(2);
  });

  it("applies category-only filters and renders the expense fallback icon path", async () => {
    hookMocks.useInfiniteMoneyTransactionFeed.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              {
                ...makeFeedRows()[0],
                operation_icon_url: null,
              },
            ],
          },
        ],
      },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });

    render(<MoneyTransactionsPage />);

    expect(screen.getByRole("button", { name: "Pharmacy" })).toBeInTheDocument();

    const user = userEvent.setup();
    await openFilterPanel(user);
    await user.click(screen.getByRole("checkbox", { name: /Food/i }));
    await user.click(screen.getByRole("button", { name: "common.apply" }));

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
    expect(String(routerMock.replace.mock.lastCall?.[0] ?? "")).toContain("categories=cat-food");
  });
});
