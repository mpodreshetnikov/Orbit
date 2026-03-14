import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MoneyCategory, MoneyCategoryRuleRun } from "@/types";
import { MoneyRuleRunReport } from "./rule-run-report";

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
    }) => (
      <button type="button" aria-label={ariaLabel}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? ""}</span>,
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

function makeCategory(overrides: Partial<MoneyCategory>): MoneyCategory {
  return {
    id: "cat-food",
    parent_id: null,
    canonical_category_id: "cat-food",
    category_kind: "canonical",
    system_key: "food",
    sort_order: 1,
    created_by: null,
    depth: 1,
    name_ru: "Еда",
    name_en: "Food",
    slug: "food",
    archived_at: null,
    created_at: "2026-03-13T00:00:00.000Z",
    updated_at: "2026-03-13T00:00:00.000Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<MoneyCategoryRuleRun> = {}): MoneyCategoryRuleRun {
  return {
    id: "run-1",
    triggered_by_user_id: null,
    person_id: "person-1",
    trigger_source: "date_range_replay",
    line_item_id: "line-1",
    line_item_title: "Latte",
    transaction_id: "tx-1",
    merchant_name: "Coffee Shop",
    starting_category_id: null,
    final_category_id: "cat-food",
    saved: true,
    llm_tokens_prompt: null,
    llm_tokens_completion: null,
    created_at: "2026-03-13T00:00:00.000Z",
    steps: [],
    ...overrides,
  };
}

describe("MoneyRuleRunReport", () => {
  const categories: MoneyCategory[] = [
    makeCategory({ id: "cat-food", canonical_category_id: "cat-food", system_key: "food" }),
    makeCategory({
      id: "cat-transport",
      canonical_category_id: "cat-transport",
      system_key: "transport",
      name_en: "Transport",
      name_ru: "Транспорт",
      slug: "transport",
      sort_order: 2,
    }),
  ];

  it("shows line item title and merchant details for each run", () => {
    render(
      <MoneyRuleRunReport
        t={(key: string) => key}
        categories={categories}
        successReport={{
          actionLabel: "money.ruleReplayDateRange",
          runs: [makeRun()],
        }}
        errorReport={null}
      />,
    );

    expect(screen.getByText("Latte")).toBeInTheDocument();
    expect(screen.getByText("Coffee Shop")).toBeInTheDocument();
  });

  it("renders empty and error report states", () => {
    const { rerender } = render(
      <MoneyRuleRunReport
        t={(key: string) => key}
        categories={categories}
        successReport={null}
        errorReport={null}
      />,
    );

    expect(screen.getByText("money.ruleReportEmpty")).toBeInTheDocument();

    rerender(
      <MoneyRuleRunReport
        t={(key: string) => key}
        categories={categories}
        successReport={null}
        errorReport={{
          actionLabel: "money.ruleReplayDateRange",
          message: "Replay failed",
        }}
      />,
    );

    expect(screen.getAllByText("money.ruleRunReportFailed")).toHaveLength(2);
    expect(screen.getByText("Replay failed")).toBeInTheDocument();
  });

  it("filters the visible runs to unmapped items or a selected mapped category", async () => {
    const user = userEvent.setup();

    render(
      <MoneyRuleRunReport
        t={(key: string) => key}
        categories={categories}
        successReport={{
          actionLabel: "money.ruleReplayDateRange",
          runs: [
            makeRun(),
            makeRun({
              id: "run-2",
              line_item_id: "line-2",
              line_item_title: "Internal transfer",
              transaction_id: "tx-2",
              merchant_name: "Maxim P.",
              final_category_id: null,
            }),
            makeRun({
              id: "run-3",
              line_item_id: "line-3",
              line_item_title: "Taxi",
              transaction_id: "tx-3",
              merchant_name: "Yandex Go",
              final_category_id: "cat-transport",
            }),
          ],
        }}
        errorReport={null}
      />,
    );

    expect(screen.getByText("Latte")).toBeInTheDocument();
    expect(screen.getByText("Internal transfer")).toBeInTheDocument();
    expect(screen.getByText("Taxi")).toBeInTheDocument();

    await user.click(screen.getByLabelText("money.ruleRunReportOnlyUnmapped"));

    expect(screen.queryByText("Latte")).not.toBeInTheDocument();
    expect(screen.getByText("Internal transfer")).toBeInTheDocument();
    expect(screen.queryByText("Taxi")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("money.ruleRunReportOnlyUnmapped"));
    await user.click(screen.getByLabelText("money.ruleRunReportMappedCategoryFilter"));
    await user.click(
      screen.getAllByRole("button").find((button) => button.textContent === "Food / Еда (food)")!,
    );

    expect(screen.getByText("Latte")).toBeInTheDocument();
    expect(screen.queryByText("Internal transfer")).not.toBeInTheDocument();
    expect(screen.queryByText("Taxi")).not.toBeInTheDocument();
  });

  it("renders preview-only rows with fallback ids and step labels", () => {
    render(
      <MoneyRuleRunReport
        t={(key: string) => key}
        categories={categories}
        successReport={{
          actionLabel: "money.ruleReplayDateRange",
          runs: [
            makeRun({
              id: null,
              line_item_title: "",
              merchant_name: "",
              line_item_id: "",
              transaction_id: "",
              final_category_id: null,
              saved: false,
              steps: [
                {
                  id: null,
                  rule_id: "rule-1",
                  sort_order: 1,
                  rule_kind: "direct",
                  rule_name: null,
                  matched: false,
                  changed_category: false,
                  previous_category_id: null,
                  next_category_id: null,
                  decision_reason: "Reviewed only",
                  debug_payload: {},
                },
              ],
            }),
          ],
        }}
        errorReport={null}
      />,
    );

    expect(screen.getByText("money.ruleRunReportPreviewOnly")).toBeInTheDocument();
    expect(screen.getAllByText("--").length).toBeGreaterThan(0);
    expect(screen.getAllByText("money.ruleKinddirect")).toHaveLength(2);
    expect(screen.getByText("Reviewed only")).toBeInTheDocument();
  });
});
