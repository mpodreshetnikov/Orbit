import { describe, expect, it } from "vitest";
import {
  niceAxisTicks,
  normalizeSpendingReport,
  transactionsFeedQuery,
} from "./money-spending-report-ux";

describe("normalizeSpendingReport", () => {
  it("layers UX fields onto the shared report payload", () => {
    const report = normalizeSpendingReport({
      period: {
        start: "2026-03-01",
        end: "2026-03-31",
        days: 31,
        compare_days: 16,
        previous_start: "2026-01-29",
        previous_end: "2026-02-28",
        previous_compare_end: "2026-02-13",
        last_year: 2025,
      },
      currency: "RUB",
      totals: { income: "5000", expense: 2200, net: 2800, last_year_expense: 310.5 },
      forecast: { expense: 2550, income: 4000, net: 1450, days_left: 11 },
      categories: [
        {
          id: "food",
          parent_id: null,
          system_key: "food",
          name_en: "Food",
          name_ru: "Еда",
          has_children: true,
          expense: 1000,
          months: [{ month_start: "2026-03-01", income: 0, expense: 1000 }],
        },
      ],
      days: [{ date: "2026-03-01", income: 0, expense: 10 }],
      merchants: [
        {
          brand_id: null,
          name: "Cafe X",
          expense: 300,
          previous_expense: 120,
          transaction_count: 1,
        },
      ],
      fx_status: { status: "ok", missing_conversions: [] },
    });

    expect(report.period.compare_days).toBe(16);
    expect(report.period.previous_compare_end).toBe("2026-02-13");
    expect(report.forecast).toEqual({
      expense: 2550,
      income: 4000,
      net: 1450,
      days_left: 11,
    });
    expect(report.merchants[0]).toMatchObject({
      name: "Cafe X",
      previous_expense: 120,
      transaction_count: 1,
    });
  });

  it("defaults compare_days to period days and derives forecast net when missing", () => {
    const report = normalizeSpendingReport({
      period: {
        start: "2026-03-01",
        end: "2026-03-31",
        days: 31,
        compare_days: 0,
        previous_start: "2026-01-29",
        previous_end: "2026-02-28",
        last_year: 2025,
      },
      currency: "RUB",
      totals: {},
      forecast: { expense: 2550, days_left: 11 },
      categories: [],
      days: [],
      merchants: [{ name: "Cafe X", expense: 300, transaction_count: 1 }],
      fx_status: { status: "ok" },
    });

    // compare_days: 0 is falsy → fall back to period.days (||, not &&)
    expect(report.period.compare_days).toBe(31);
    expect(report.period.previous_compare_end).toBe("2026-02-28");
    expect(report.forecast).toEqual({
      expense: 2550,
      income: 0,
      net: -2550,
      days_left: 11,
    });
    expect(report.merchants[0]?.previous_expense).toBe(0);
  });

  it("uses an explicit forecast net of zero instead of recomputing", () => {
    const report = normalizeSpendingReport({
      period: {
        start: "2026-03-01",
        end: "2026-03-31",
        days: 31,
        previous_start: "2026-01-29",
        previous_end: "2026-02-28",
        last_year: 2025,
      },
      currency: "RUB",
      totals: {},
      forecast: { expense: 100, income: 250, net: 0, days_left: 2 },
      categories: [],
      days: [],
      merchants: [],
      fx_status: { status: "ok" },
    });

    expect(report.forecast?.net).toBe(0);
  });

  it("leaves forecast null when the payload has none", () => {
    const report = normalizeSpendingReport(null);
    expect(report.forecast).toBeNull();
    expect(report.period.compare_days).toBe(0);
    expect(report.period.previous_compare_end).toBe("");
    expect(report.merchants).toEqual([]);
  });

  it("falls back from a zero compare_days to period days", () => {
    const report = normalizeSpendingReport({
      period: {
        start: "2026-03-01",
        end: "2026-03-31",
        days: 31,
        compare_days: 0,
        previous_start: "2026-01-29",
        previous_end: "2026-02-28",
        last_year: 2025,
      },
      currency: "RUB",
      totals: {},
      forecast: null,
      categories: [],
      days: [],
      merchants: [],
      fx_status: { status: "ok" },
    });
    expect(report.period.compare_days).toBe(31);
  });

});

describe("niceAxisTicks", () => {
  it("returns [0] for non-positive or non-finite maxima", () => {
    expect(niceAxisTicks(0)).toEqual([0]);
    expect(niceAxisTicks(-5)).toEqual([0]);
    expect(niceAxisTicks(Number.NaN)).toEqual([0]);
  });

  it("builds round Y-axis ticks covering the max across 1/2/5×10ⁿ bands", () => {
    // normalized ≤1 → step = 10ⁿ
    expect(niceAxisTicks(8, 4)).toEqual([0, 2, 4, 6, 8]);
    expect(niceAxisTicks(40, 4)).toEqual([0, 10, 20, 30, 40]);
    // normalized ≤2 → step = 2×10ⁿ
    expect(niceAxisTicks(50, 4)).toEqual([0, 20, 40, 60]);
    // normalized ≤5 → step = 5×10ⁿ
    expect(niceAxisTicks(87)).toEqual([0, 50, 100]);
    expect(niceAxisTicks(100, 4)).toEqual([0, 50, 100]);
    expect(niceAxisTicks(120, 5)).toEqual([0, 50, 100, 150]);
    // normalized >5 → step = 10×10ⁿ
    expect(niceAxisTicks(250, 4)).toEqual([0, 100, 200, 300]);
    expect(niceAxisTicks(1000)[niceAxisTicks(1000).length - 1]).toBeGreaterThanOrEqual(1000);
    expect(niceAxisTicks(900, 4)[niceAxisTicks(900, 4).length - 1]).toBeGreaterThanOrEqual(900);
    expect(niceAxisTicks(3)[niceAxisTicks(3).length - 1]).toBeGreaterThanOrEqual(3);
    expect(niceAxisTicks(15)[niceAxisTicks(15).length - 1]).toBeGreaterThanOrEqual(15);
  });
});

describe("transactionsFeedQuery", () => {
  it("builds a shareable transactions feed query from report filters", () => {
    expect(
      transactionsFeedQuery({
        start: "2026-11-01",
        end: "2026-11-16",
        accountIds: ["acc-1"],
        categoryId: "cat-food",
        merchantName: "Pyaterochka",
        mode: "expense",
      }),
    ).toBe(
      "preset=custom&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-16T23%3A59%3A59.999Z&accounts=acc-1&categories=cat-food&q=Pyaterochka&sign=expense",
    );
  });

  it("omits optional filters, empty accounts, and non expense/income modes", () => {
    expect(
      transactionsFeedQuery({
        start: "2026-11-01",
        end: "2026-11-02",
        accountIds: [],
        mode: "income",
      }),
    ).toBe(
      "preset=custom&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-02T23%3A59%3A59.999Z&sign=income",
    );
    expect(
      transactionsFeedQuery({
        start: "2026-11-01",
        end: "2026-11-02",
      }),
    ).toBe("preset=custom&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-02T23%3A59%3A59.999Z");
    expect(
      transactionsFeedQuery({
        start: "2026-01-01",
        end: "2026-01-02",
        accountIds: [],
        categoryId: null,
        merchantName: null,
        mode: "net" as never,
      }),
    ).toBe("preset=custom&from=2026-01-01T00%3A00%3A00.000Z&to=2026-01-02T23%3A59%3A59.999Z");
  });
});
