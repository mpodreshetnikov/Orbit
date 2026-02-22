import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoneyTransactionsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useMoneyAccounts: vi.fn(),
  useMoneyTransactions: vi.fn(),
}));

let selectedPersonIdState: string | null = "person-1";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  useMoneyAccounts: (...args: unknown[]) => hookMocks.useMoneyAccounts(...args),
  useMoneyTransactions: (...args: unknown[]) => hookMocks.useMoneyTransactions(...args),
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
  useIntlLocale: () => "en-US",
}));

vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  const SelectContext = ReactModule.createContext<(value: string) => void>(() => {});

  return {
    Select: ({
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={(value) => onValueChange?.(value)}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({
      value,
      children,
      className,
    }: {
      value: string;
      children: React.ReactNode;
      className?: string;
    }) => {
      const onSelect = ReactModule.useContext(SelectContext);
      return (
        <button type="button" className={className} onClick={() => onSelect(value)}>
          {children}
        </button>
      );
    },
  };
});

function makeAccounts() {
  return [
    {
      id: "acc-1",
      account_label: "Main card",
      is_active: true,
    },
    {
      id: "acc-2",
      account_label: "Dormant",
      is_active: false,
    },
  ];
}

function makeTransactions() {
  return [
    {
      id: "tx-1",
      account_id: "acc-1",
      posted_at: "2026-01-02T10:00:00.000Z",
      merchant_name: "Pharmacy",
      comment: "Order",
      amount: -1200,
      currency: "RUB",
      transaction_type: "expense",
      money_cards: { last4: "1234", card_label: "Blue" },
    },
    {
      id: "tx-2",
      account_id: "acc-2",
      posted_at: "2026-01-03T10:00:00.000Z",
      merchant_name: null,
      comment: null,
      amount: 800,
      currency: "RUB",
      transaction_type: "income",
      money_cards: null,
    },
  ];
}

describe("MoneyTransactionsPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    hookMocks.useMoneyAccounts.mockReturnValue({ data: makeAccounts() });
    hookMocks.useMoneyTransactions.mockReturnValue({
      data: makeTransactions(),
      isLoading: false,
    });
  });

  it("renders person prompt, loading state, and empty state", () => {
    selectedPersonIdState = null;
    const noPerson = render(<MoneyTransactionsPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
    noPerson.unmount();

    selectedPersonIdState = "person-1";
    hookMocks.useMoneyTransactions.mockReturnValueOnce({
      data: [],
      isLoading: true,
    });
    const loading = render(<MoneyTransactionsPage />);
    expect(loading.container.querySelector(".animate-pulse")).toBeTruthy();
    loading.unmount();

    hookMocks.useMoneyTransactions.mockReturnValueOnce({
      data: [],
      isLoading: false,
    });
    render(<MoneyTransactionsPage />);
    expect(screen.getByText("money.noTransactions")).toBeInTheDocument();
    expect(screen.getByText("money.noTransactionsHint")).toBeInTheDocument();
  });

  it("renders transactions, filters by search, and applies account filter", async () => {
    render(<MoneyTransactionsPage />);

    expect(screen.getByText("Pharmacy")).toBeInTheDocument();
    expect(screen.getByText("money.transactionFallback")).toBeInTheDocument();
    expect(screen.getByText("*1234 (Blue)")).toBeInTheDocument();
    expect(screen.getByText("money.transactionTypeExpense")).toBeInTheDocument();
    expect(screen.getByText("money.transactionTypeIncome")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("money.searchTransactions"), "pharma");
    expect(screen.getByText("Pharmacy")).toBeInTheDocument();
    expect(screen.queryByText("money.transactionFallback")).toBeNull();

    await user.clear(screen.getByPlaceholderText("money.searchTransactions"));
    await user.click(screen.getByRole("button", { name: "Main card" }));

    await waitFor(() => {
      expect(hookMocks.useMoneyTransactions).toHaveBeenLastCalledWith("person-1", {
        accountId: "acc-1",
      });
    });
  });
});
