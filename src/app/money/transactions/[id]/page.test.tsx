import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoneyTransactionDetailPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useMoneyAccounts: vi.fn(),
  useMoneyCategories: vi.fn(),
  useMoneyMerchantDefaultCategories: vi.fn(),
  useMoneyTransaction: vi.fn(),
  useMoneyTransactions: vi.fn(),
  useUpdateMoneyTransaction: vi.fn(),
  useDeleteMoneyTransaction: vi.fn(),
  usePersons: vi.fn(),
  useUIStore: vi.fn(),
}));

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
}));

const updateMutateAsyncMock = vi.fn();
const deleteMutateAsyncMock = vi.fn();

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
  useMoneyTransaction: (...args: unknown[]) => hookMocks.useMoneyTransaction(...args),
  useMoneyTransactions: (...args: unknown[]) => hookMocks.useMoneyTransactions(...args),
  useUpdateMoneyTransaction: (...args: unknown[]) => hookMocks.useUpdateMoneyTransaction(...args),
  useDeleteMoneyTransaction: (...args: unknown[]) => hookMocks.useDeleteMoneyTransaction(...args),
  usePersons: (...args: unknown[]) => hookMocks.usePersons(...args),
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
            amount: -1200,
            currency: "RUB",
            transaction_type: "expense",
            status: "posted",
            merchant_name: "Store",
            comment: "updated",
            line_items: [{ title: "Milk", amount: 1200 }],
          })
        }
      >
        submit-edit
      </button>
      <button type="button" onClick={onCancel}>
        cancel-edit
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => <div>{open ? children : null}</div>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

function renderPage() {
  return render(<MoneyTransactionDetailPage params={resolvedParams("tx-1")} />);
}

function resolvedParams(id: string): Promise<{ id: string }> {
  return {
    status: "fulfilled",
    value: { id },
    then: (resolve: (value: { id: string }) => void) => resolve({ id }),
  } as unknown as Promise<{ id: string }>;
}

describe("MoneyTransactionDetailPage", () => {
  beforeEach(() => {
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    updateMutateAsyncMock.mockReset();
    deleteMutateAsyncMock.mockReset();
    updateMutateAsyncMock.mockResolvedValue(undefined);
    deleteMutateAsyncMock.mockResolvedValue(undefined);

    hookMocks.useUIStore.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        selectedPersonId: "person-1",
      }),
    );
    hookMocks.useMoneyAccounts.mockReturnValue({ data: [{ id: "acc-1", account_label: "Main" }] });
    hookMocks.useMoneyCategories.mockReturnValue({ data: [] });
    hookMocks.useMoneyMerchantDefaultCategories.mockReturnValue({ data: {} });
    hookMocks.useMoneyTransactions.mockReturnValue({ data: [] });
    hookMocks.usePersons.mockReturnValue({ data: [{ id: "person-1", name: "Alex" }] });
    hookMocks.useUpdateMoneyTransaction.mockReturnValue({
      mutateAsync: updateMutateAsyncMock,
      isPending: false,
    });
    hookMocks.useDeleteMoneyTransaction.mockReturnValue({
      mutateAsync: deleteMutateAsyncMock,
      isPending: false,
    });
    hookMocks.useMoneyTransaction.mockReturnValue({
      data: {
        id: "tx-1",
        payer_person_id: "person-1",
        line_items: [{ title: "Milk", amount: 1000 }],
        money_cards: { last4: "1234", card_label: "Daily" },
      },
      isLoading: false,
    });
  });

  it("renders person prompt when no person is selected", async () => {
    hookMocks.useUIStore.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        selectedPersonId: null,
      }),
    );

    renderPage();
    expect(await screen.findByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("renders loading and empty states", async () => {
    hookMocks.useMoneyTransaction.mockReturnValue({ data: null, isLoading: true });
    const { container, rerender } = renderPage();
    expect(container.querySelector(".animate-pulse")).toBeTruthy();

    hookMocks.useMoneyTransaction.mockReturnValue({ data: null, isLoading: false });
    rerender(<MoneyTransactionDetailPage params={resolvedParams("tx-1")} />);
    expect(await screen.findByText("common.noResults")).toBeInTheDocument();
  });

  it("updates and deletes transaction", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("money.editTransaction")).toBeInTheDocument();
    expect(screen.getByText("money.card: *1234 (Daily)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "submit-edit" }));
    await waitFor(() => {
      expect(updateMutateAsyncMock).toHaveBeenCalledWith({
        id: "tx-1",
        updates: {
          account_id: "acc-1",
          posted_at: "2026-02-10T10:00:00.000Z",
          amount: -1200,
          currency: "RUB",
          transaction_type: "expense",
          status: "posted",
          merchant_name: "Store",
          comment: "updated",
        },
        lineItems: [{ title: "Milk", amount: 1200 }],
      });
      expect(routerMock.push).toHaveBeenCalledWith("/money/transactions");
    });

    await user.click(screen.getByRole("button", { name: "cancel-edit" }));
    expect(routerMock.push).toHaveBeenCalledWith("/money/transactions");

    await user.click(screen.getByRole("button", { name: "money.deleteTransaction" }));
    await user.click(screen.getAllByRole("button", { name: "money.deleteTransaction" })[1]);

    await waitFor(() => {
      expect(deleteMutateAsyncMock).toHaveBeenCalledWith({
        id: "tx-1",
        payerPersonId: "person-1",
      });
    });
  });
});
