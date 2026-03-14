import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MoneyRuleEditor } from "./rule-editor";
import type { MoneyCategoryRule } from "@/types";

const hookMocks = vi.hoisted(() => ({
  useCreateMoneyCategoryRule: vi.fn(),
  useMoneyAccounts: vi.fn(),
  useMoneyCategories: vi.fn(),
  useMoneyCategoryRules: vi.fn(),
  useMoneyTransaction: vi.fn(),
  useMoneyTransactions: vi.fn(),
  usePersons: vi.fn(),
  usePreviewMoneyCategoryRulePipeline: vi.fn(),
  useUpdateMoneyCategoryRule: vi.fn(),
}));

const uiStoreState = vi.hoisted(() => ({
  selectedPersonId: "person-1" as string | null,
}));

const createRuleMutateAsync = vi.fn();
const updateRuleMutateAsync = vi.fn();
const previewPipelineMutateAsync = vi.fn();
const pushMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/lib/date-locale", () => ({
  useIntlLocale: () => "en-US",
}));

vi.mock("@/hooks", () => ({
  useCreateMoneyCategoryRule: (...args: unknown[]) => hookMocks.useCreateMoneyCategoryRule(...args),
  useMoneyAccounts: (...args: unknown[]) => hookMocks.useMoneyAccounts(...args),
  useMoneyCategories: (...args: unknown[]) => hookMocks.useMoneyCategories(...args),
  useMoneyCategoryRules: (...args: unknown[]) => hookMocks.useMoneyCategoryRules(...args),
  useMoneyTransaction: (...args: unknown[]) => hookMocks.useMoneyTransaction(...args),
  useMoneyTransactions: (...args: unknown[]) => hookMocks.useMoneyTransactions(...args),
  usePersons: (...args: unknown[]) => hookMocks.usePersons(...args),
  usePreviewMoneyCategoryRulePipeline: (...args: unknown[]) =>
    hookMocks.usePreviewMoneyCategoryRulePipeline(...args),
  useUpdateMoneyCategoryRule: (...args: unknown[]) => hookMocks.useUpdateMoneyCategoryRule(...args),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: typeof uiStoreState) => unknown) => selector(uiStoreState),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    id,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    id?: string;
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  const SelectContext = ReactModule.createContext<{
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
    SelectTrigger: ({
      children,
      "aria-label": ariaLabel,
    }: {
      children: React.ReactNode;
      "aria-label"?: string;
    }) => {
      const ctx = ReactModule.useContext(SelectContext);
      return (
        <button type="button" aria-label={ariaLabel}>
          {ctx.value}
          {children}
        </button>
      );
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const ctx = ReactModule.useContext(SelectContext);
      return (
        <button type="button" onClick={() => ctx.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

function makeRule(overrides: Partial<MoneyCategoryRule> = {}): MoneyCategoryRule {
  return {
    id: "rule-1",
    person_id: "person-1",
    name: "Groceries",
    description: null,
    enabled: true,
    sort_order: 1,
    rule_kind: "direct",
    target_category_id: "cat-food",
    match_mode: "all",
    scope_filter: "all_line_items",
    filters: [],
    config: {},
    stop_processing: false,
    created_by: null,
    created_at: "2026-03-10T00:00:00.000Z",
    updated_at: "2026-03-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("MoneyRuleEditor", () => {
  beforeEach(() => {
    pushMock.mockReset();
    createRuleMutateAsync.mockReset();
    updateRuleMutateAsync.mockReset();
    previewPipelineMutateAsync.mockReset();

    createRuleMutateAsync.mockResolvedValue(makeRule({ id: "rule-new" }));
    updateRuleMutateAsync.mockResolvedValue(makeRule());
    previewPipelineMutateAsync.mockResolvedValue({
      steps: [
        {
          rule_id: "rule-1",
          sort_order: 1,
          rule_name: "Groceries",
          rule_kind: "direct",
          changed_category: true,
          decision_reason: "Direct rule assigned Food",
        },
      ],
      final_category_id: "cat-food",
      trigger_source: "single_preview",
    });

    hookMocks.useCreateMoneyCategoryRule.mockReturnValue({
      mutateAsync: createRuleMutateAsync,
      isPending: false,
    });
    hookMocks.useUpdateMoneyCategoryRule.mockReturnValue({
      mutateAsync: updateRuleMutateAsync,
      isPending: false,
    });
    hookMocks.usePreviewMoneyCategoryRulePipeline.mockReturnValue({
      mutateAsync: previewPipelineMutateAsync,
      isPending: false,
    });
    hookMocks.useMoneyAccounts.mockReturnValue({
      data: [{ id: "account-1", source: "tbank", account_kind: "card" }],
    });
    hookMocks.useMoneyCategories.mockReturnValue({
      data: [
        {
          id: "cat-food",
          canonical_category_id: "cat-food",
          category_kind: "canonical",
          system_key: "food",
          depth: 1,
          sort_order: 1,
          name_en: "Food",
          name_ru: "Еда",
        },
        {
          id: "cat-uncategorized",
          canonical_category_id: "cat-uncategorized",
          category_kind: "canonical",
          system_key: "uncategorized",
          depth: 1,
          sort_order: 2,
          name_en: "Uncategorized",
          name_ru: "Без категории",
        },
      ],
    });
    hookMocks.useMoneyCategoryRules.mockReturnValue({
      data: [makeRule()],
    });
    hookMocks.useMoneyTransactions.mockReturnValue({
      data: [
        {
          id: "tx-1",
          account_id: "account-1",
          payer_person_id: "person-1",
          merchant_name: "Market",
          comment: "Weekly",
          source_category_name: null,
          posted_at: "2026-03-10T00:00:00.000Z",
          amount: 25,
          currency: "USD",
        },
      ],
    });
    hookMocks.useMoneyTransaction.mockReturnValue({
      data: {
        id: "tx-1",
        account_id: "account-1",
        payer_person_id: "person-1",
        merchant_name: "Market",
        comment: "Weekly",
        source_comment: null,
        source: "tbank",
        source_category_id: null,
        source_category_name: null,
        mcc: "5411",
        transaction_type: "expense",
        amount: 25,
        currency: "USD",
        is_transfer: false,
        line_items: [
          {
            id: "line-1",
            title: "Milk",
            amount: 12,
            category_id: "cat-food",
          },
        ],
      },
      isLoading: false,
    });
    hookMocks.usePersons.mockReturnValue({
      data: [{ id: "person-1", name: "Alex" }],
    });
  });

  it("creates a direct rule with no filters by default", async () => {
    const user = userEvent.setup();
    render(<MoneyRuleEditor mode="create" />);

    expect(screen.getByText("money.ruleNoFiltersHint")).toBeInTheDocument();

    await user.type(screen.getByLabelText("money.ruleName"), "Coffee shops");
    await user.click(screen.getAllByText(/Food \/ Еда/)[0]);
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(createRuleMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          person_id: "person-1",
          name: "Coffee shops",
          rule_kind: "direct",
          target_category_id: "cat-food",
          filters: [],
          sort_order: 2,
        }),
      );
    });

    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("/money/rules/rule-new/edit"));
  });

  it("does not expose removed history rule kinds", () => {
    render(<MoneyRuleEditor mode="create" />);

    expect(screen.queryByText("money.ruleKindmerchant_history")).not.toBeInTheDocument();
    expect(screen.queryByText("money.ruleKindline_item_history")).not.toBeInTheDocument();
  });

  it("validates regex filters before save", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    render(<MoneyRuleEditor mode="create" />);

    await user.type(screen.getByLabelText("money.ruleName"), "Regex rule");
    await user.click(screen.getAllByText(/Food \/ Еда/)[0]);
    await user.click(screen.getByRole("button", { name: "money.ruleAddFilter" }));

    const filterCards = screen.getAllByText(/money.ruleExampleValue/);
    const filterCard = filterCards[0]?.closest(".rounded-xl") as HTMLElement | null;
    expect(filterCard).not.toBeNull();
    if (!filterCard) return;

    await user.click(within(filterCard).getByText("money.ruleOperatorRegex"));
    await user.type(screen.getByLabelText("money.ruleFilterValue"), "(");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    expect(toast.error).toHaveBeenCalledWith("money.ruleValidationRegexInvalid");
    expect(createRuleMutateAsync).not.toHaveBeenCalled();
  });

  it("saves contains-any-of-set filters as explicit set operators", async () => {
    const user = userEvent.setup();
    render(<MoneyRuleEditor mode="edit" rule={makeRule()} />);

    await user.clear(screen.getByLabelText("money.ruleName"));
    await user.type(screen.getByLabelText("money.ruleName"), "Coffee match");
    await user.click(screen.getByRole("button", { name: "money.ruleAddFilter" }));

    const filterCards = screen.getAllByText(/money.ruleExampleValue/);
    const filterCard = filterCards[0]?.closest(".rounded-xl") as HTMLElement | null;
    expect(filterCard).not.toBeNull();
    if (!filterCard) return;

    await user.click(within(filterCard).getByText("money.ruleOperatorContainsAnyOfSet"));
    await user.type(within(filterCard).getByRole("textbox"), "coffee, market");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(updateRuleMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "rule-1",
          updates: expect.objectContaining({
            filters: [
              {
                field: "merchant_name",
                operator: "contains_any_in_set",
                values: ["coffee", "market"],
              },
            ],
          }),
        }),
      );
    });
  });

  it("auto-previews a saved rule on the selected example line item", async () => {
    render(
      <MoneyRuleEditor
        mode="edit"
        rule={makeRule()}
        initialExampleTransactionId="tx-1"
        initialExampleLineItemId="line-1"
        autoRunExample
      />,
    );

    await waitFor(() => {
      expect(previewPipelineMutateAsync).toHaveBeenCalledWith({
        lineItemId: "line-1",
        personId: "person-1",
        ruleIds: ["rule-1"],
      });
    });

    expect(screen.getByText("Direct rule assigned Food")).toBeInTheDocument();
  });

  it("does not auto-preview when autorun is disabled", async () => {
    render(
      <MoneyRuleEditor
        mode="edit"
        rule={makeRule()}
        initialExampleTransactionId="tx-1"
        initialExampleLineItemId="line-1"
        autoRunExample={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("money.rulePreviewEmpty")).toBeInTheDocument();
    });

    expect(previewPipelineMutateAsync).not.toHaveBeenCalled();
  });

  it("does not re-run autorun preview when the same rule refreshes after save", async () => {
    const { rerender } = render(
      <MoneyRuleEditor
        mode="edit"
        rule={makeRule()}
        initialExampleTransactionId="tx-1"
        initialExampleLineItemId="line-1"
        autoRunExample
      />,
    );

    await waitFor(() => {
      expect(previewPipelineMutateAsync).toHaveBeenCalledTimes(1);
    });

    rerender(
      <MoneyRuleEditor
        mode="edit"
        rule={makeRule({ updated_at: "2026-03-11T00:00:00.000Z" })}
        initialExampleTransactionId="tx-1"
        initialExampleLineItemId="line-1"
        autoRunExample
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("money.rulePreviewEmpty")).toBeInTheDocument();
    });

    expect(previewPipelineMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("waits for a valid example line item before auto-previewing", async () => {
    render(
      <MoneyRuleEditor
        mode="edit"
        rule={makeRule()}
        initialExampleTransactionId="tx-1"
        initialExampleLineItemId="line-missing"
        autoRunExample
      />,
    );

    await waitFor(() => {
      expect(previewPipelineMutateAsync).toHaveBeenCalledWith({
        lineItemId: "line-1",
        personId: "person-1",
        ruleIds: ["rule-1"],
      });
    });

    expect(previewPipelineMutateAsync).not.toHaveBeenCalledWith({
      lineItemId: "line-missing",
      personId: "person-1",
      ruleIds: ["rule-1"],
    });
  });

  it("keeps save enabled while preview is pending", () => {
    hookMocks.usePreviewMoneyCategoryRulePipeline.mockReturnValue({
      mutateAsync: previewPipelineMutateAsync,
      isPending: true,
    });

    render(
      <MoneyRuleEditor
        mode="edit"
        rule={makeRule()}
        initialExampleTransactionId="tx-1"
        initialExampleLineItemId="line-1"
      />,
    );

    expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /money.ruleSaveAndPreviewExample/i })).toBeDisabled();
    expect(screen.getByText("money.rulePreviewResult")).toBeInTheDocument();
  });

  it("saves dirty edits before previewing an existing rule", async () => {
    const user = userEvent.setup();

    render(
      <MoneyRuleEditor
        mode="edit"
        rule={makeRule({
          filters: [{ field: "line_item_title", operator: "contains", value: "soap" }],
        })}
        initialExampleTransactionId="tx-1"
        initialExampleLineItemId="line-1"
      />,
    );

    const valueInput = screen.getByLabelText("money.ruleFilterValue");
    await user.clear(valueInput);
    await user.type(valueInput, "dish");
    const previewButton = screen.getByRole("button", { name: /money.ruleSaveAndPreviewExample/i });
    expect(previewButton).toBeInTheDocument();
    await user.click(previewButton);

    await waitFor(() => {
      expect(updateRuleMutateAsync).toHaveBeenCalledWith({
        id: "rule-1",
        updates: expect.objectContaining({
          filters: [{ field: "line_item_title", operator: "contains", value: "dish" }],
        }),
      });
    });

    await waitFor(() => {
      expect(previewPipelineMutateAsync).toHaveBeenCalledWith({
        lineItemId: "line-1",
        personId: "person-1",
        ruleIds: ["rule-1"],
      });
    });

    expect(updateRuleMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      previewPipelineMutateAsync.mock.invocationCallOrder[0],
    );
  });

  it("saves dirty llm edits before running the example", async () => {
    const user = userEvent.setup();

    render(
      <MoneyRuleEditor
        mode="edit"
        rule={makeRule({
          rule_kind: "llm_categorization",
          target_category_id: null,
          config: { prompt: "Old prompt" },
        })}
        initialExampleTransactionId="tx-1"
        initialExampleLineItemId="line-1"
      />,
    );

    const promptInput = screen.getByLabelText("money.rulePrompt");
    await user.clear(promptInput);
    await user.type(promptInput, "New prompt");
    await user.click(screen.getByRole("button", { name: /money.ruleRunExample/i }));

    await waitFor(() => {
      expect(updateRuleMutateAsync).toHaveBeenCalledWith({
        id: "rule-1",
        updates: expect.objectContaining({
          rule_kind: "llm_categorization",
          config: { prompt: "New prompt" },
        }),
      });
    });

    await waitFor(() => {
      expect(previewPipelineMutateAsync).toHaveBeenCalledWith({
        lineItemId: "line-1",
        personId: "person-1",
        ruleIds: ["rule-1"],
      });
    });

    expect(updateRuleMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      previewPipelineMutateAsync.mock.invocationCallOrder[0],
    );
  });
});
