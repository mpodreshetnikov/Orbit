import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoneyRulesPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useMoneyCategories: vi.fn(),
  useMoneyCategoryRules: vi.fn(),
  useDeleteMoneyCategoryRule: vi.fn(),
  useReorderMoneyCategoryRules: vi.fn(),
  usePreviewMoneyCategoryRulePipeline: vi.fn(),
  useApplyMoneyCategoryRulePipeline: vi.fn(),
  useReplayMoneyCategoryRulePipelineForTransaction: vi.fn(),
  useReplayMoneyCategoryRulePipelineForDateRange: vi.fn(),
  usePersons: vi.fn(),
}));

const uiStoreState = vi.hoisted(() => ({
  selectedPersonId: "person-1" as string | null,
}));

const deleteRuleMutateAsync = vi.fn();
const reorderRulesMutateAsync = vi.fn();
const previewPipelineMutateAsync = vi.fn();
const applyPipelineMutateAsync = vi.fn();
const replayTransactionMutateAsync = vi.fn();
const replayDateRangeMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/hooks", () => ({
  useMoneyCategories: (...args: unknown[]) => hookMocks.useMoneyCategories(...args),
  useMoneyCategoryRules: (...args: unknown[]) => hookMocks.useMoneyCategoryRules(...args),
  useDeleteMoneyCategoryRule: (...args: unknown[]) => hookMocks.useDeleteMoneyCategoryRule(...args),
  useReorderMoneyCategoryRules: (...args: unknown[]) =>
    hookMocks.useReorderMoneyCategoryRules(...args),
  usePreviewMoneyCategoryRulePipeline: (...args: unknown[]) =>
    hookMocks.usePreviewMoneyCategoryRulePipeline(...args),
  useApplyMoneyCategoryRulePipeline: (...args: unknown[]) =>
    hookMocks.useApplyMoneyCategoryRulePipeline(...args),
  useReplayMoneyCategoryRulePipelineForTransaction: (...args: unknown[]) =>
    hookMocks.useReplayMoneyCategoryRulePipelineForTransaction(...args),
  useReplayMoneyCategoryRulePipelineForDateRange: (...args: unknown[]) =>
    hookMocks.useReplayMoneyCategoryRulePipelineForDateRange(...args),
  usePersons: (...args: unknown[]) => hookMocks.usePersons(...args),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: typeof uiStoreState) => unknown) => selector(uiStoreState),
}));

function makeRule(overrides: Record<string, unknown> = {}) {
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

describe("MoneyRulesPage", () => {
  beforeEach(() => {
    uiStoreState.selectedPersonId = "person-1";

    deleteRuleMutateAsync.mockReset();
    reorderRulesMutateAsync.mockReset();
    previewPipelineMutateAsync.mockReset();
    applyPipelineMutateAsync.mockReset();
    replayTransactionMutateAsync.mockReset();
    replayDateRangeMutateAsync.mockReset();

    deleteRuleMutateAsync.mockResolvedValue(undefined);
    reorderRulesMutateAsync.mockResolvedValue(undefined);
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
    });
    applyPipelineMutateAsync.mockResolvedValue([]);
    replayTransactionMutateAsync.mockResolvedValue([]);
    replayDateRangeMutateAsync.mockResolvedValue([]);

    hookMocks.useMoneyCategories.mockReturnValue({
      data: [
        {
          id: "cat-food",
          name_en: "Food",
          name_ru: "Еда",
          system_key: "food",
        },
      ],
    });
    hookMocks.useMoneyCategoryRules.mockReturnValue({
      data: [
        makeRule({
          filters: [{ field: "line_item_title", operator: "contains", value: "Banana" }],
        }),
        makeRule({ id: "rule-2", name: "Fallback", sort_order: 2 }),
      ],
      isLoading: false,
    });
    hookMocks.useDeleteMoneyCategoryRule.mockReturnValue({
      mutateAsync: deleteRuleMutateAsync,
      isPending: false,
    });
    hookMocks.useReorderMoneyCategoryRules.mockReturnValue({
      mutateAsync: reorderRulesMutateAsync,
      isPending: false,
    });
    hookMocks.usePreviewMoneyCategoryRulePipeline.mockReturnValue({
      mutateAsync: previewPipelineMutateAsync,
      isPending: false,
    });
    hookMocks.useApplyMoneyCategoryRulePipeline.mockReturnValue({
      mutateAsync: applyPipelineMutateAsync,
      isPending: false,
    });
    hookMocks.useReplayMoneyCategoryRulePipelineForTransaction.mockReturnValue({
      mutateAsync: replayTransactionMutateAsync,
      isPending: false,
    });
    hookMocks.useReplayMoneyCategoryRulePipelineForDateRange.mockReturnValue({
      mutateAsync: replayDateRangeMutateAsync,
      isPending: false,
    });
    hookMocks.usePersons.mockReturnValue({
      data: [{ id: "person-1", name: "Alex", kind: "human" }],
    });
  });

  it("renders standalone add and edit links", () => {
    hookMocks.useMoneyCategoryRules.mockReturnValue({
      data: [
        makeRule({
          filters: [
            {
              field: "merchant_name",
              operator: "contains_any_in_set",
              values: ["coffee", "market"],
            },
          ],
        }),
        makeRule({ id: "rule-2", name: "Fallback", sort_order: 2 }),
      ],
      isLoading: false,
    });

    render(<MoneyRulesPage />);

    expect(screen.getByText("money.rules")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /money.addRule/i })).toHaveAttribute(
      "href",
      "/money/rules/new",
    );
    expect(screen.getByRole("link", { name: /money.ruleOpenReplayReview/i })).toHaveAttribute(
      "href",
      "/money/rules/replay-review",
    );
    expect(screen.getAllByRole("link", { name: /common.edit/i })[0]).toHaveAttribute(
      "href",
      "/money/rules/rule-1/edit",
    );
    expect(
      screen.getByText("Merchant name contains any of set 'coffee', 'market'"),
    ).toBeInTheDocument();
  });

  it("reorders and deletes rules", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MoneyRulesPage />);

    await user.click(screen.getAllByRole("button", { name: "money.ruleMoveDown" })[0]);
    await waitFor(() => {
      expect(reorderRulesMutateAsync).toHaveBeenCalledWith({
        personId: "person-1",
        orderedRuleIds: ["rule-2", "rule-1"],
      });
    });

    await user.click(screen.getAllByRole("button", { name: "common.delete" })[0]);
    await waitFor(() => {
      expect(deleteRuleMutateAsync).toHaveBeenCalledWith({
        id: "rule-1",
        personId: "person-1",
      });
    });
    expect(confirmSpy).toHaveBeenCalledWith("money.ruleDeleteConfirm");
    confirmSpy.mockRestore();
  });

  it("renders empty and person-prompt states", () => {
    uiStoreState.selectedPersonId = null;

    const { rerender } = render(<MoneyRulesPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();

    uiStoreState.selectedPersonId = "person-1";
    hookMocks.useMoneyCategoryRules.mockReturnValue({
      data: [],
      isLoading: false,
    });

    rerender(<MoneyRulesPage />);
    expect(screen.getByText("money.noRules")).toBeInTheDocument();
    expect(screen.getByText("money.noRulesHint")).toBeInTheDocument();
  });
});
