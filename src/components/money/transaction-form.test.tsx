import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    canonical_category_id: "cat-food",
    category_kind: "canonical",
    system_key: "food",
    sort_order: 1,
    created_by: null,
    depth: 1,
    name_ru: "Food RU",
    name_en: "Food",
    slug: "canonical-food",
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "cat-other",
    parent_id: null,
    canonical_category_id: "cat-other",
    category_kind: "canonical",
    system_key: "other",
    sort_order: 2,
    created_by: null,
    depth: 1,
    name_ru: "Other RU",
    name_en: "Other",
    slug: "canonical-other",
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
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: "acc-1",
          posted_at: new Date("2026-02-21T09:30").toISOString(),
          amount: -1200,
          currency: "RUB",
          transaction_type: "expense",
          status: "posted",
          merchant_name: "Shop A",
          comment: "",
          line_items: [
            expect.objectContaining({
              title: "Milk",
              amount: 1200,
              quantity: 1,
              unit: "money.unitPcs",
              line_status: "final",
              category_id: "cat-food",
              category_locked_by_user: false,
              beneficiary_person_id: "person-1",
              assignment_method: "manual",
            }),
          ],
        }),
      );
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

  it("keeps a manually selected category locked when the merchant changes", async () => {
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
    fireEvent.change(postedAtInput, { target: { value: "2026-02-21T09:30" } });

    fireEvent.change(screen.getByPlaceholderText("-1200"), { target: { value: "-1200" } });
    fireEvent.change(screen.getByPlaceholderText("money.lineItemTitle"), {
      target: { value: "Milk" },
    });
    fireEvent.change(screen.getByPlaceholderText("money.merchantPlaceholder"), {
      target: { value: "Shop A" },
    });

    const spinButtons = screen.getAllByRole("spinbutton");
    fireEvent.change(spinButtons[1], { target: { value: "1200" } });

    await user.click(screen.getByRole("button", { name: "Food / Food RU" }));
    await user.click(screen.getByRole("button", { name: "Other / Other RU" }));

    fireEvent.change(screen.getByPlaceholderText("money.merchantPlaceholder"), {
      target: { value: "Shop A Updated" },
    });

    await user.click(screen.getByRole("button", { name: "money.saveTransaction" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            expect.objectContaining({
              category_id: "cat-other",
              category_locked_by_user: true,
              assignment_method: "manual",
            }),
          ],
        }),
      );
    });
  });

  it("preserves existing line-item identifiers and rule metadata on edit submit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <MoneyTransactionForm
        mode="edit"
        accounts={accounts}
        categories={categories}
        persons={persons}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        initialTransaction={{
          id: "tx-1",
          payer_person_id: "person-1",
          account_id: "acc-1",
          card_id: null,
          source: "manual",
          external_id: null,
          posted_at: "2026-02-21T09:30:00.000Z",
          amount: 1200,
          currency: "RUB",
          transaction_type: "expense",
          status: "posted",
          merchant_name: "Coffee House",
          mcc: null,
          comment: "Keep metadata",
          is_transfer: false,
          transfer_group_id: null,
          raw_payload: null,
          dedupe_hash: null,
          created_at: "2026-02-21T09:30:00.000Z",
          updated_at: "2026-02-21T09:30:00.000Z",
        }}
        initialLineItems={[
          {
            id: "line-1",
            transaction_id: "tx-1",
            title: "Flat white",
            amount: 1200,
            quantity: 1,
            unit: "pcs",
            line_status: "final",
            related_line_item_id: null,
            category_id: "cat-food",
            beneficiary_person_id: "person-1",
            assignment_method: "rule",
            assignment_rule_id: "rule-1",
            assignment_confidence: 0.91,
            raw_payload: { source: "import" },
            category_locked_by_user: false,
            last_category_rule_id: "rule-1",
            last_category_rule_run_id: "run-1",
            category_assigned_at: "2026-02-21T09:31:00.000Z",
            created_at: "2026-02-21T09:30:00.000Z",
            updated_at: "2026-02-21T09:31:00.000Z",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "money.updateTransaction" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            expect.objectContaining({
              id: "line-1",
              title: "Flat white",
              assignment_method: "rule",
              assignment_rule_id: "rule-1",
              assignment_confidence: 0.91,
              raw_payload: { source: "import" },
              last_category_rule_id: "rule-1",
              last_category_rule_run_id: "run-1",
              category_assigned_at: "2026-02-21T09:31:00.000Z",
            }),
          ],
        }),
      );
    });
  });
});
