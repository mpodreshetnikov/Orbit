import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoneyRulesReplayReviewPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useMoneyCategories: vi.fn(),
  usePreviewMoneyCategoryRulePipeline: vi.fn(),
  useApplyMoneyCategoryRulePipeline: vi.fn(),
  useReplayMoneyCategoryRulePipelineForTransaction: vi.fn(),
  useReplayMoneyCategoryRulePipelineForDateRange: vi.fn(),
  usePersons: vi.fn(),
}));

const uiStoreState = vi.hoisted(() => ({
  selectedPersonId: "person-1" as string | null,
}));

const previewPipelineMutateAsync = vi.fn();
const applyPipelineMutateAsync = vi.fn();
const replayTransactionMutateAsync = vi.fn();
const replayDateRangeMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useMoneyCategories: (...args: unknown[]) => hookMocks.useMoneyCategories(...args),
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

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    person_id: "person-1",
    trigger_source: "single_transaction_replay",
    line_item_id: "line-1",
    transaction_id: "tx-1",
    starting_category_id: null,
    final_category_id: "cat-food",
    saved: true,
    llm_tokens_prompt: null,
    llm_tokens_completion: null,
    created_at: "2026-03-11T00:00:00.000Z",
    steps: [
      {
        id: "step-1",
        rule_id: "rule-1",
        rule_name: "Groceries",
        rule_kind: "direct",
        sort_order: 1,
        matched: true,
        changed_category: true,
        previous_category_id: null,
        next_category_id: "cat-food",
        decision_reason: "Direct rule assigned Food",
        debug_payload: {},
      },
    ],
    ...overrides,
  };
}

describe("MoneyRulesReplayReviewPage", () => {
  beforeEach(() => {
    uiStoreState.selectedPersonId = "person-1";

    previewPipelineMutateAsync.mockReset();
    applyPipelineMutateAsync.mockReset();
    replayTransactionMutateAsync.mockReset();
    replayDateRangeMutateAsync.mockReset();

    previewPipelineMutateAsync.mockResolvedValue(
      makeRun({ trigger_source: "single_preview", saved: false }),
    );
    applyPipelineMutateAsync.mockResolvedValue([
      makeRun({
        id: "run-apply",
        trigger_source: "single_line_item_replay",
        line_item_id: "line-5",
      }),
    ]);
    replayTransactionMutateAsync.mockResolvedValue([
      makeRun({
        id: "run-transaction",
        transaction_id: "tx-77",
      }),
    ]);
    replayDateRangeMutateAsync.mockResolvedValue([
      makeRun({
        id: "run-range-1",
        trigger_source: "date_range_replay",
        line_item_id: "line-9",
        transaction_id: "tx-9",
      }),
      makeRun({
        id: "run-range-2",
        trigger_source: "date_range_replay",
        line_item_id: "line-10",
        transaction_id: "tx-10",
        starting_category_id: "cat-food",
        final_category_id: "cat-food",
        steps: [
          {
            id: "step-2",
            rule_id: "rule-2",
            rule_name: "No-op",
            rule_kind: "fallback_uncategorized",
            sort_order: 2,
            matched: false,
            changed_category: false,
            previous_category_id: "cat-food",
            next_category_id: "cat-food",
            decision_reason: "Rule skipped because category already matched",
            debug_payload: {},
          },
        ],
      }),
    ]);

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

  it("renders a detailed date-range report with every affected run", async () => {
    const user = userEvent.setup();
    render(<MoneyRulesReplayReviewPage />);

    await user.type(screen.getByLabelText("money.ruleFromDate"), "2026-03-01");
    await user.type(screen.getByLabelText("money.ruleToDate"), "2026-03-10");
    await user.click(screen.getByRole("button", { name: "money.ruleReplayDateRange" }));

    await waitFor(() => {
      expect(replayDateRangeMutateAsync).toHaveBeenCalledWith({
        personId: "person-1",
        from: "2026-03-01",
        to: "2026-03-10",
        forceOverwriteLocked: false,
      });
    });

    const report = screen.getByTestId("money-rule-report");
    expect(within(report).getByText("money.ruleReportTitle")).toBeInTheDocument();
    expect(within(report).getByText(/money\.ruleRunReportCountLabel/)).toBeInTheDocument();
    expect(within(report).getByText(/money\.ruleRunReportCountLabel: 2/)).toBeInTheDocument();
    expect(within(report).getByText("line-9")).toBeInTheDocument();
    expect(within(report).getByText("line-10")).toBeInTheDocument();
    expect(within(report).getByText("Direct rule assigned Food")).toBeInTheDocument();
    expect(
      within(report).getByText("Rule skipped because category already matched"),
    ).toBeInTheDocument();
  });

  it("keeps failure details visible when a replay action fails", async () => {
    const user = userEvent.setup();
    replayTransactionMutateAsync.mockRejectedValueOnce(
      new Error("Transaction tx-missing was not found for category pipeline"),
    );

    render(<MoneyRulesReplayReviewPage />);

    await user.type(screen.getByLabelText("money.ruleTransactionId"), "tx-missing");
    await user.click(screen.getByRole("button", { name: "money.ruleReplayTransaction" }));

    await waitFor(() => {
      expect(screen.getAllByText("money.ruleRunReportFailed")).toHaveLength(2);
    });
    expect(
      screen.getByText(
        "The selected transaction is no longer available. Choose another transaction and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("shows change details for a single line-item apply run", async () => {
    const user = userEvent.setup();
    render(<MoneyRulesReplayReviewPage />);

    await user.type(screen.getByLabelText("money.ruleLineItemId"), "line-5");
    await user.click(screen.getByRole("button", { name: "money.ruleApplyToLineItem" }));

    await waitFor(() => {
      expect(applyPipelineMutateAsync).toHaveBeenCalledWith({
        lineItemIds: ["line-5"],
        personId: "person-1",
        forceOverwriteLocked: false,
        triggerSource: "single_line_item_replay",
      });
    });

    const report = screen.getByTestId("money-rule-report");
    expect(within(report).getByText("money.ruleRunReportSucceeded")).toBeInTheDocument();
    expect(within(report).getByText("line-5")).toBeInTheDocument();
    expect(within(report).getByText("Food / Еда (food)")).toBeInTheDocument();
    expect(within(report).getByText("Direct rule assigned Food")).toBeInTheDocument();
  });
});
