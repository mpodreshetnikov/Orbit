import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewMoneyTransactionPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useMoneyAccounts: vi.fn(),
  useMoneyCategories: vi.fn(),
  useMoneyMerchantDefaultCategories: vi.fn(),
  useMoneyTransactions: vi.fn(),
  usePersons: vi.fn(),
  useCreateMoneyTransaction: vi.fn(),
  useUIStore: vi.fn(),
}));

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
}));

const createMutateAsyncMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/hooks", () => ({
  useMoneyAccounts: (...args: unknown[]) => hookMocks.useMoneyAccounts(...args),
  useMoneyCategories: (...args: unknown[]) => hookMocks.useMoneyCategories(...args),
  useMoneyMerchantDefaultCategories: (...args: unknown[]) =>
    hookMocks.useMoneyMerchantDefaultCategories(...args),
  useMoneyTransactions: (...args: unknown[]) => hookMocks.useMoneyTransactions(...args),
  usePersons: (...args: unknown[]) => hookMocks.usePersons(...args),
  useCreateMoneyTransaction: (...args: unknown[]) => hookMocks.useCreateMoneyTransaction(...args),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (...args: unknown[]) => hookMocks.useUIStore(...args),
}));

vi.mock("@/components/money", () => ({
  MoneyTransactionForm: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (values: unknown) => void | Promise<void>;
    onCancel: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onSubmit({
            account_id: "acc-1",
            posted_at: "2026-02-10T10:00:00.000Z",
            amount: -1500,
            currency: "RUB",
            transaction_type: "expense",
            status: "posted",
            merchant_name: "Store",
            comment: "note",
            line_items: [{ title: "Milk", amount: 1500 }],
          })
        }
      >
        submit-transaction
      </button>
      <button type="button" onClick={onCancel}>
        cancel-transaction
      </button>
    </div>
  ),
}));

describe("NewMoneyTransactionPage", () => {
  beforeEach(() => {
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    createMutateAsyncMock.mockReset();
    createMutateAsyncMock.mockResolvedValue({ id: "tx-1" });

    hookMocks.useUIStore.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        selectedPersonId: "person-1",
      }),
    );
    hookMocks.useMoneyAccounts.mockReturnValue({ data: [{ id: "acc-1", account_label: "Main" }] });
    hookMocks.useMoneyCategories.mockReturnValue({ data: [] });
    hookMocks.useMoneyMerchantDefaultCategories.mockReturnValue({ data: {} });
    hookMocks.useMoneyTransactions.mockReturnValue({
      data: [{ id: "old-1", merchant_name: "Store" }],
    });
    hookMocks.usePersons.mockReturnValue({ data: [{ id: "person-1", name: "Alex" }] });
    hookMocks.useCreateMoneyTransaction.mockReturnValue({
      mutateAsync: createMutateAsyncMock,
      isPending: false,
    });
  });

  it("renders select-person prompt when no person is selected", () => {
    hookMocks.useUIStore.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        selectedPersonId: null,
      }),
    );

    render(<NewMoneyTransactionPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("shows no-accounts warning and creates a transaction", async () => {
    hookMocks.useMoneyAccounts.mockReturnValue({ data: [] });
    const user = userEvent.setup();

    render(<NewMoneyTransactionPage />);
    expect(screen.getByText("money.noAccounts")).toBeInTheDocument();
    expect(screen.getByText("money.noAccountsHint")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "submit-transaction" }));

    await waitFor(() => {
      expect(createMutateAsyncMock).toHaveBeenCalledWith({
        transaction: {
          payer_person_id: "person-1",
          account_id: "acc-1",
          posted_at: "2026-02-10T10:00:00.000Z",
          amount: -1500,
          currency: "RUB",
          transaction_type: "expense",
          status: "posted",
          merchant_name: "Store",
          comment: "note",
        },
        lineItems: [{ title: "Milk", amount: 1500 }],
      });
      expect(routerMock.push).toHaveBeenCalledWith("/money/transactions/tx-1");
    });

    await user.click(screen.getByRole("button", { name: "cancel-transaction" }));
    expect(routerMock.push).toHaveBeenCalledWith("/money/transactions");
  });
});
