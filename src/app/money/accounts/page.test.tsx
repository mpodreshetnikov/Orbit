import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyAccount, MoneyCard } from "@/types";
import MoneyAccountsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useMoneyAccounts: vi.fn(),
  useCreateMoneyAccount: vi.fn(),
  useUpdateMoneyAccount: vi.fn(),
  useDeleteMoneyAccount: vi.fn(),
  useMoneyCardsByAccountIds: vi.fn(),
  useCreateMoneyCard: vi.fn(),
  useUpdateMoneyCard: vi.fn(),
  useDeleteMoneyCard: vi.fn(),
}));

let selectedPersonIdState: string | null = "person-1";
let searchParamsState = new URLSearchParams();

const createAccountMutateAsync = vi.fn();
const updateAccountMutateAsync = vi.fn();
const deleteAccountMutateAsync = vi.fn();
const createCardMutateAsync = vi.fn();
const updateCardMutateAsync = vi.fn();
const deleteCardMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsState,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  useMoneyAccounts: (...args: unknown[]) => hookMocks.useMoneyAccounts(...args),
  useCreateMoneyAccount: (...args: unknown[]) => hookMocks.useCreateMoneyAccount(...args),
  useUpdateMoneyAccount: (...args: unknown[]) => hookMocks.useUpdateMoneyAccount(...args),
  useDeleteMoneyAccount: (...args: unknown[]) => hookMocks.useDeleteMoneyAccount(...args),
  useMoneyCardsByAccountIds: (...args: unknown[]) => hookMocks.useMoneyCardsByAccountIds(...args),
  useCreateMoneyCard: (...args: unknown[]) => hookMocks.useCreateMoneyCard(...args),
  useUpdateMoneyCard: (...args: unknown[]) => hookMocks.useUpdateMoneyCard(...args),
  useDeleteMoneyCard: (...args: unknown[]) => hookMocks.useDeleteMoneyCard(...args),
}));

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
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="alert-root" data-open={open ? "true" : "false"}>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        close-alert
      </button>
      {open ? children : null}
    </div>
  ),
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
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

function makeAccount(overrides: Partial<MoneyAccount> = {}): MoneyAccount {
  return {
    id: "acc-1",
    owner_person_id: "person-1",
    source: "manual",
    account_kind: "card",
    account_label: "Main card",
    currency: "RUB",
    external_account_id: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCard(overrides: Partial<MoneyCard> = {}): MoneyCard {
  return {
    id: "card-1",
    account_id: "acc-1",
    last4: "1234",
    card_label: "Visa",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function setupData(params: {
  accounts?: MoneyAccount[] | undefined;
  cards?: MoneyCard[] | undefined;
  isLoading?: boolean;
}) {
  hookMocks.useMoneyAccounts.mockReturnValue({
    data: params.accounts,
    isLoading: params.isLoading ?? false,
  });
  hookMocks.useMoneyCardsByAccountIds.mockReturnValue({
    data: params.cards,
  });
}

describe("MoneyAccountsPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    searchParamsState = new URLSearchParams();

    createAccountMutateAsync.mockReset();
    updateAccountMutateAsync.mockReset();
    deleteAccountMutateAsync.mockReset();
    createCardMutateAsync.mockReset();
    updateCardMutateAsync.mockReset();
    deleteCardMutateAsync.mockReset();

    createAccountMutateAsync.mockResolvedValue(undefined);
    updateAccountMutateAsync.mockResolvedValue(undefined);
    deleteAccountMutateAsync.mockResolvedValue(undefined);
    createCardMutateAsync.mockResolvedValue(undefined);
    updateCardMutateAsync.mockResolvedValue(undefined);
    deleteCardMutateAsync.mockResolvedValue(undefined);

    hookMocks.useCreateMoneyAccount.mockReturnValue({
      mutateAsync: createAccountMutateAsync,
      isPending: false,
    });
    hookMocks.useUpdateMoneyAccount.mockReturnValue({
      mutateAsync: updateAccountMutateAsync,
      isPending: false,
    });
    hookMocks.useDeleteMoneyAccount.mockReturnValue({
      mutateAsync: deleteAccountMutateAsync,
      isPending: false,
    });
    hookMocks.useCreateMoneyCard.mockReturnValue({
      mutateAsync: createCardMutateAsync,
      isPending: false,
    });
    hookMocks.useUpdateMoneyCard.mockReturnValue({
      mutateAsync: updateCardMutateAsync,
      isPending: false,
    });
    hookMocks.useDeleteMoneyCard.mockReturnValue({
      mutateAsync: deleteCardMutateAsync,
      isPending: false,
    });
  });

  it("renders person selection prompt when no person is selected", () => {
    selectedPersonIdState = null;
    setupData({ accounts: [], cards: [] });

    render(<MoneyAccountsPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("opens create dialog from query param and creates account", async () => {
    searchParamsState = new URLSearchParams("new=1");
    setupData({ accounts: [], cards: [] });

    render(<MoneyAccountsPage />);
    const user = userEvent.setup();

    const [accountLabelInput] = await screen.findAllByRole("textbox");
    await user.type(accountLabelInput, "Family wallet");
    await user.click(screen.getAllByRole("button", { name: "common.save" })[0]);

    await waitFor(() => {
      expect(createAccountMutateAsync).toHaveBeenCalledWith({
        owner_person_id: "person-1",
        account_label: "Family wallet",
        account_kind: "card",
        currency: "RUB",
        source: "manual",
        external_account_id: null,
        is_active: true,
      });
    });
  });

  it("edits and deletes an existing account", async () => {
    setupData({
      accounts: [makeAccount()],
      cards: [],
    });

    render(<MoneyAccountsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "common.edit" }));
    const [labelInput] = screen.getAllByRole("textbox");
    await user.clear(labelInput);
    await user.type(labelInput, "Updated account");
    await user.click(screen.getAllByRole("button", { name: "common.save" })[0]);

    await waitFor(() => {
      expect(updateAccountMutateAsync).toHaveBeenCalledWith({
        id: "acc-1",
        updates: expect.objectContaining({
          account_label: "Updated account",
          account_kind: "card",
          currency: "RUB",
          source: "manual",
          external_account_id: null,
          is_active: true,
        }),
      });
    });

    await user.click(screen.getAllByRole("button", { name: "common.delete" })[0]);
    await user.click(screen.getAllByRole("button", { name: "common.delete" })[1]);

    await waitFor(() => {
      expect(deleteAccountMutateAsync).toHaveBeenCalledWith({
        id: "acc-1",
        ownerPersonId: "person-1",
      });
    });
  });

  it("adds a card and normalizes last4 before submit", async () => {
    setupData({
      accounts: [makeAccount()],
      cards: [makeCard()],
    });

    render(<MoneyAccountsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "money.addCard" }));
    await user.type(screen.getByPlaceholderText("1234"), "xx98765");
    await user.type(screen.getByPlaceholderText("money.cardLabel"), "Debit");
    await user.click(screen.getAllByRole("button", { name: "common.save" })[0]);

    await waitFor(() => {
      expect(createCardMutateAsync).toHaveBeenCalledWith({
        account_id: "acc-1",
        last4: "9876",
        card_label: "Debit",
      });
    });
  });
});
