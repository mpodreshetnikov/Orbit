import { describe, expect, it } from "vitest";
import type { MoneyBudgetCategoryNode } from "./money";
import {
  actualForMode,
  currentReportMonth,
  normalizeBudgetReport,
  normalizeBudgetTarget,
  reportMonthLabel,
  resolveMoneyFxSyncRange,
  shiftReportMonth,
  signedTarget,
  targetDraftOf,
  targetForMode,
} from "./money-reports";

describe("normalizeBudgetReport", () => {
  it("builds the category tree from the flat rows, with direct targets", () => {
    const report = normalizeBudgetReport({
      report_month_start: "2026-10-01",
      report_currency: "USD",
      actual_income: "100",
      actual_expense: -40,
      target_expense: -50,
      net_variance: 10,
      category_rows: [
        { id: "food", name_en: "Food", actual_expense: -40, direct_target_amount: -50 },
        { id: "cafe", parent_id: "food", name_en: "Cafe", system_key: "uncategorized" },
        { id: "orphan", parent_id: "gone" },
        null,
        { name_en: "no id" },
      ],
      trend_points: [{ date: "2026-10-01", actual_income: 1, actual_expense: -2, actual_net: -1 }],
      fx_status: {
        mode: "approximated",
        approximated_dates: ["2026-10-02", { conversion_date: "2026-10-03" }, 5],
      },
    });
    expect(report).toMatchObject({
      month_start: "2026-10-01",
      currency: "USD",
      summary: { actual_income: 100, actual_expenses: -40, target_expenses: -50, variance_net: 10 },
      trend: [{ date: "2026-10-01", income: 1, expenses: -2, net: -1 }],
      fx_status: {
        mode: "approximate",
        approximated_dates: ["2026-10-02", "2026-10-03"],
        is_blocking: false,
      },
    });
    expect(report.categories.map((node) => node.id)).toEqual(["food", "orphan"]);
    expect(report.categories[0]).toMatchObject({
      actual_expenses: -40,
      target: { category_id: "food", target_amount: -50, currency: "USD" },
      children: [{ id: "cafe", is_uncategorized: true, target: null }],
    });
  });

  it("takes a ready tree, and reads missing exchange rates as blocking", () => {
    const report = normalizeBudgetReport({
      month_start: "2026-10-01",
      categories: [{ id: "food", children: [{ id: "cafe" }], target: { id: "t" } }, null],
      trend: [{ date: "2026-10-01", income: 3, expenses: -1, net: 2 }, null],
      fx_status: {
        status: "error",
        missing_conversions: [
          "USD",
          { source_currency: "EUR", conversion_date: "2026-10-01" },
          { source_currency: "GBP" },
          null,
        ],
      },
    });
    expect(report.currency).toBe("RUB");
    expect(report.categories[0]).toMatchObject({
      id: "food",
      target: null,
      children: [{ id: "cafe" }],
    });
    expect(report.categories[1]).toMatchObject({ id: "", name_en: "", children: [] });
    expect(report.trend[1]).toEqual({ date: "", income: 0, expenses: 0, net: 0 });
    expect(report.fx_status).toMatchObject({
      mode: "missing",
      missing_pairs: ["USD", "EUR:2026-10-01", "GBP"],
      is_blocking: true,
    });
  });

  it("reads an empty row as an empty report", () => {
    const report = normalizeBudgetReport(null);
    expect(report).toMatchObject({ month_start: "", currency: "RUB", categories: [], trend: [] });
    expect(report.fx_status).toMatchObject({ mode: "ok", is_blocking: false });
    expect(normalizeBudgetReport({ fx_status: { status: "missing" } }).fx_status.mode).toBe(
      "missing",
    );
    expect(normalizeBudgetReport({ fx_status: { status: "approximate" } }).fx_status.mode).toBe(
      "approximate",
    );
    expect(normalizeBudgetReport({ category_rows: "x" }).categories).toEqual([]);
  });
});

describe("normalizeBudgetTarget", () => {
  it("needs its ids and month, and fills the rest", () => {
    expect(normalizeBudgetTarget(null)).toBeNull();
    expect(normalizeBudgetTarget({ id: "t", person_id: "p", category_id: "c" })).toBeNull();
    expect(
      normalizeBudgetTarget({
        id: "t",
        person_id: "p",
        category_id: "c",
        month_start: "2026-10-01",
        target_amount: "abc",
      }),
    ).toEqual({
      id: "t",
      person_id: "p",
      category_id: "c",
      month_start: "2026-10-01",
      target_amount: 0,
      currency: "RUB",
      created_at: "",
      updated_at: "",
    });
  });
});

describe("resolveMoneyFxSyncRange", () => {
  const today = new Date("2026-10-15T12:00:00Z");

  it("runs to the month's end, or to today in the current month, and not at all for a future one", () => {
    expect(resolveMoneyFxSyncRange("2026-09-01", today)).toEqual({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(resolveMoneyFxSyncRange("2026-10-01", today)?.endDate).toBe("2026-10-15");
    expect(resolveMoneyFxSyncRange("2026-11-01", today)).toBeNull();
    expect(resolveMoneyFxSyncRange("2026-1", today)).toBeNull();
    expect(resolveMoneyFxSyncRange("2026-13-45", today)).toBeNull();
  });
});

describe("the report month", () => {
  it("starts on this month, steps across years, and reads as a month", () => {
    expect(currentReportMonth(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01");
    expect(shiftReportMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftReportMonth("2026-12", 1)).toBe("2027-01");
    expect(reportMonthLabel("2026-10", "en")).toBe("October 2026");
  });
});

describe("a category's target", () => {
  const node = (target_amount: number, changes: Partial<MoneyBudgetCategoryNode> = {}) =>
    ({
      target_amount,
      target: null,
      actual_income: 10,
      actual_expenses: -20,
      actual_net: -10,
      ...changes,
    }) as MoneyBudgetCategoryNode;

  it("opens on its direction and amount, and saves signed", () => {
    expect(targetDraftOf(node(-50))).toEqual({ direction: "expense", amount: "50" });
    expect(targetDraftOf(node(0))).toEqual({ direction: "income", amount: "" });
    expect(
      targetDraftOf(
        node(0, { target: { target_amount: 30 } as MoneyBudgetCategoryNode["target"] }),
      ),
    ).toEqual({ direction: "income", amount: "30" });
    expect(signedTarget({ direction: "expense", amount: "12,5" })).toBe(-12.5);
    expect(signedTarget({ direction: "income", amount: "7" })).toBe(7);
    expect(signedTarget({ direction: "income", amount: "0" })).toBeNull();
    expect(signedTarget({ direction: "income", amount: "x" })).toBeNull();
  });

  it("is read for the chart's mode", () => {
    expect([actualForMode(node(-5), "income"), targetForMode(node(-5), "income")]).toEqual([10, 0]);
    expect([actualForMode(node(-5), "expenses"), targetForMode(node(-5), "expenses")]).toEqual([
      20, 5,
    ]);
    expect([actualForMode(node(5), "net"), targetForMode(node(-5), "net")]).toEqual([10, 5]);
    expect([targetForMode(node(5), "income"), targetForMode(node(5), "expenses")]).toEqual([5, 0]);
  });
});
