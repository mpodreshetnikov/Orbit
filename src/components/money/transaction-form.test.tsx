import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyAccount, MoneyCategory } from "@/types";
import { MoneyTransactionForm } from "./transaction-form";

const toastErrorMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/date-locale", () => ({
  useIntlLocale: () => "en-US",
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
    className,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      aria-label={placeholder ?? "command-input"}
      className={className}
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
    value,
  }: {
    children: React.ReactNode;
    onSelect?: (value: string) => void;
    value?: string;
  }) => (
    <button type="button" onClick={() => onSelect?.(value ?? "")}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <div role="combobox" aria-controls="mock-listbox" aria-expanded={false}>
        {children}
      </div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? ""}</span>,
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
      const ctx = React.useContext(SelectContext);
      const selected = ctx.value === value;
      return (
        <button
          type="button"
          className={className}
          aria-pressed={selected}
          onClick={() => ctx.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
  };
});

function sampleAccount(overrides: Partial<MoneyAccount> = {}): MoneyAccount {
  return {
    id: "acc-1",
    owner_person_id: "person-1",
    source: "manual",
    account_kind: "debit",
    account_label: "Main account",
    currency: "RUB",
    external_account_id: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const accounts: MoneyAccount[] = [
  sampleAccount(),
  sampleAccount({
    id: "acc-2",
    account_label: "Savings",
    currency: "USD",
    is_active: false,
  }),
];

const categories: MoneyCategory[] = [
  {
    id: "cat-food",
    parent_id: null,
    depth: 0,
    name_ru: "Food RU",
    name_en: "Food",
    slug: "food",
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

const persons = [{ id: "person-1", name: "Alex" }];

describe("MoneyTransactionForm", () => {
  beforeEach(() => {
    toastErrorMock.mockReset();
  });

  it("shows required-field validation errors before submit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MoneyTransactionForm
        mode="create"
        accounts={accounts}
        categories={categories}
        persons={persons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "money.saveTransaction" }));
    expect(toastErrorMock).toHaveBeenLastCalledWith("money.validationAccountRequired");

    await user.click(screen.getByRole("button", { name: /Main account \(RUB\)/ }));

    const postedAtInput = document.querySelector(
      "input[type='datetime-local']",
    ) as HTMLInputElement;
    await user.clear(postedAtInput);
    await user.click(screen.getByRole("button", { name: "money.saveTransaction" }));
    expect(toastErrorMock).toHaveBeenLastCalledWith("money.validationPostedAtRequired");

    await user.type(postedAtInput, "2026-02-21T09:30");
    await user.click(screen.getByRole("button", { name: "money.saveTransaction" }));
    expect(toastErrorMock).toHaveBeenLastCalledWith("money.validationAmountRequired");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits normalized create payload with inferred defaults", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MoneyTransactionForm
        mode="create"
        accounts={accounts}
        categories={categories}
        persons={persons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        selectedPersonId="person-1"
        merchantDefaultCategoryId={{ "Shop A": "cat-food" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Main account \(RUB\)/ }));

    const postedAtInput = document.querySelector(
      "input[type='datetime-local']",
    ) as HTMLInputElement;
    await user.clear(postedAtInput);
    await user.type(postedAtInput, "2026-02-21T09:30");

    await user.type(screen.getByPlaceholderText("-1200"), "-1200");
    await user.type(screen.getByPlaceholderText("money.merchantPlaceholder"), "Shop A");
    await user.type(screen.getByPlaceholderText("money.lineItemTitle"), "Milk");

    const spinButtons = screen.getAllByRole("spinbutton");
    await user.type(spinButtons[1], "1200");

    await user.click(screen.getByRole("button", { name: "money.saveTransaction" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        account_id: "acc-1",
        posted_at: new Date("2026-02-21T09:30").toISOString(),
        amount: -1200,
        currency: "RUB",
        transaction_type: "expense",
        status: "posted",
        merchant_name: "Shop A",
        comment: "",
        line_items: [
          {
            title: "Milk",
            amount: 1200,
            quantity: 1,
            unit: "money.unitPcs",
            line_status: "final",
            category_id: "cat-food",
            beneficiary_person_id: "person-1",
            assignment_method: "manual",
          },
        ],
      });
    });
  });

  it("supports merchant suggestions, mismatch warning, and cancel action", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <MoneyTransactionForm
        mode="create"
        accounts={accounts}
        categories={categories}
        persons={persons}
        onSubmit={onSubmit}
        onCancel={onCancel}
        existingMerchantNames={["Cafe", "Groceries"]}
        merchantDefaultCategoryId={{ Cafe: "cat-food" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Main account \(RUB\)/ }));
    await user.type(screen.getByPlaceholderText("-1200"), "50");

    const spinButtons = screen.getAllByRole("spinbutton");
    await user.type(spinButtons[1], "30");
    expect(screen.getByText("money.lineItemsMismatch")).toBeInTheDocument();

    await user.click(screen.getByPlaceholderText("money.merchantPlaceholder"));
    await user.click(screen.getByRole("button", { name: "Cafe" }));

    await user.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
