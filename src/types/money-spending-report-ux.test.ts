import { describe, expect, it } from "vitest";
import { normalizeSpendingReport } from "@/types/money-spending-report-ux";

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

    expect(report.period.start).toBe("2026-03-01");
    expect(report.period.end).toBe("2026-03-31");
    expect(report.period.days).toBe(31);
    expect(report.period.compare_days).toBe(16);
    expect(report.period.previous_compare_end).toBe("2026-02-13");
    expect(report.forecast).toEqual({
      expense: 2550,
      income: 4000,
      net: 1450,
      days_left: 11,
    });
    expect(report.merchants).toHaveLength(1);
    expect(report.merchants[0]).toMatchObject({
      brand_id: null,
      name: "Cafe X",
      expense: 300,
      previous_expense: 120,
      transaction_count: 1,
    });
  });

  it("defaults compare_days and previous_compare_end; derives forecast net when missing", () => {
    const report = normalizeSpendingReport({
      period: {
        start: "2026-03-01",
        end: "2026-03-31",
        days: 31,
        compare_days: 0,
        previous_start: "2026-01-29",
        previous_end: "2026-02-28",
        previous_compare_end: "   ",
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

    expect(report.period.compare_days).toBe(31);
    expect(report.period.previous_compare_end).toBe("2026-02-28");
    expect(report.forecast).toEqual({
      expense: 2550,
      income: 0,
      net: -2550,
      days_left: 11,
    });
    expect(report.merchants[0]?.name).toBe("Cafe X");
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

  it("ignores non-object forecasts, arrays, and non-array merchants", () => {
    const period = {
      start: "2026-03-01",
      end: "2026-03-31",
      days: 10,
      previous_start: "2026-01-29",
      previous_end: "2026-02-28",
      last_year: 2025,
    };
    for (const forecast of ["nope", 12, true, null, undefined] as const) {
      const report = normalizeSpendingReport({
        period,
        currency: "RUB",
        totals: {},
        forecast,
        categories: [],
        days: [],
        merchants: "nope",
        fx_status: { status: "ok" },
      });
      expect(report.forecast).toBeNull();
      expect(report.merchants).toEqual([]);
    }

    // Base normalize treats an array forecast as an empty object; UX must still drop it.
    const asArray = normalizeSpendingReport({
      period,
      currency: "RUB",
      totals: {},
      forecast: [],
      categories: [],
      days: [],
      merchants: [],
      fx_status: { status: "ok" },
    });
    expect(asArray.forecast).toBeNull();
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
    expect(report.period.previous_end).toBe("2026-02-28");
    expect(report.period.previous_compare_end).toBe("2026-02-28");
  });

  it("keeps a negative compare_days from collapsing to the raw value via >= 0", () => {
    const report = normalizeSpendingReport({
      period: {
        start: "2026-03-01",
        end: "2026-03-31",
        days: 31,
        compare_days: -4,
        previous_start: "2026-01-29",
        previous_end: "2026-02-28",
        last_year: 2025,
      },
      currency: "RUB",
      totals: {},
      forecast: null,
      categories: [],
      days: [],
      merchants: [
        { name: "A", expense: 1, previous_expense: 9, transaction_count: 1 },
        { name: "B", expense: 2, previous_expense: 8, transaction_count: 1 },
      ],
      fx_status: { status: "ok" },
    });
    expect(report.period.compare_days).toBe(31);
    expect(report.merchants.map((m) => m.previous_expense)).toEqual([9, 8]);
    expect(report.merchants.map((m) => m.name)).toEqual(["A", "B"]);
  });
});
