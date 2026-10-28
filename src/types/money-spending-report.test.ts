import { describe, expect, it } from "vitest";
import {
  changeTone,
  childCategories,
  formatChange,
  formatReportAmount,
  normalizeSpendingReport,
  parsePeriod,
  percentChange,
  periodContaining,
  periodDays,
  periodLabel,
  shiftPeriod,
  squarify,
  topCategories,
  treemapShade,
  type SpendingCategory,
} from "./money-spending-report";

function category(
  id: string,
  parent: string | null,
  expense: number,
  income = 0,
): SpendingCategory {
  return {
    id,
    parent_id: parent,
    system_key: null,
    name_en: id,
    name_ru: id,
    has_children: false,
    income,
    expense,
    previous_income: 0,
    previous_expense: 0,
    last_year_income: 0,
    last_year_expense: 0,
    months: [],
  };
}

describe("normalizeSpendingReport", () => {
  it("reads what money_get_spending_report returns", () => {
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
      totals: { income: "5000", expense: 2200, net: 2800, last_year_expense: 310.5 },
      forecast: { expense: 2550, days_left: 11 },
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
        { name_en: "no id, dropped" },
      ],
      days: [{ date: "2026-03-01", income: 0, expense: 10 }],
      merchants: [{ brand_id: null, name: "Cafe X", expense: 300, transaction_count: 1 }],
      fx_status: {
        status: "error",
        missing_conversions: [{ conversion_date: "2026-03-15", source_currency: "USD" }, {}],
      },
    });

    expect(report.period.previous_start).toBe("2026-01-29");
    expect(report.totals).toMatchObject({
      income: 5000,
      expense: 2200,
      last_year_expense: 310.5,
      previous_net: 0,
    });
    expect(report.forecast).toEqual({ expense: 2550, days_left: 11 });
    expect(report.categories).toHaveLength(1);
    expect(report.categories[0]).toMatchObject({ id: "food", name_ru: "Еда", has_children: true });
    expect(report.categories[0]!.months[0]).toEqual({
      month_start: "2026-03-01",
      income: 0,
      expense: 1000,
    });
    expect(report.merchants[0]).toMatchObject({
      name: "Cafe X",
      logo_url: null,
      transaction_count: 1,
    });
    expect(report.fx_status).toEqual({ status: "error", missing: ["USD:2026-03-15"] });
  });

  it("survives nothing at all", () => {
    const report = normalizeSpendingReport(null);
    expect(report.currency).toBe("RUB");
    expect(report.forecast).toBeNull();
    expect(report.categories).toEqual([]);
    expect(report.fx_status.status).toBe("ok");
  });
});

describe("periods", () => {
  it("finds the month, the Monday-first week and the last 30 days around a day", () => {
    expect(periodContaining("month", "2026-10-28")).toEqual({
      kind: "month",
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(periodContaining("week", "2026-10-28")).toEqual({
      kind: "week",
      start: "2026-10-26",
      end: "2026-11-01",
    });
    expect(periodContaining("week", "2026-11-01")).toEqual({
      kind: "week",
      start: "2026-10-26",
      end: "2026-11-01",
    });
    expect(periodContaining("last30", "2026-10-28")).toEqual({
      kind: "last30",
      start: "2026-09-29",
      end: "2026-10-28",
    });
  });

  it("steps by whole months, and by the period's length otherwise", () => {
    expect(shiftPeriod({ kind: "month", start: "2026-03-01", end: "2026-03-31" }, -1)).toEqual({
      kind: "month",
      start: "2026-02-01",
      end: "2026-02-28",
    });
    expect(shiftPeriod({ kind: "custom", start: "2026-10-05", end: "2026-10-14" }, 1)).toEqual({
      kind: "custom",
      start: "2026-10-15",
      end: "2026-10-24",
    });
    expect(periodDays({ start: "2026-10-05", end: "2026-10-14" })).toBe(10);
  });

  it("reads the URL, falling back to this month", () => {
    expect(parsePeriod("custom", "2026-10-05", "2026-10-20", "2026-10-28")).toEqual({
      kind: "custom",
      start: "2026-10-05",
      end: "2026-10-20",
    });
    expect(parsePeriod("custom", "2026-10-20", "2026-10-05", "2026-10-28").kind).toBe("month");
    expect(parsePeriod("week", "2026-10-14", null, "2026-10-28").start).toBe("2026-10-12");
    expect(parsePeriod(null, "garbage", null, "2026-10-28").start).toBe("2026-10-01");
  });

  it("labels a month by name and anything else as a range", () => {
    expect(periodLabel({ kind: "month", start: "2026-10-01", end: "2026-10-31" }, "en-US")).toBe(
      "October 2026",
    );
    expect(periodLabel({ kind: "week", start: "2026-10-26", end: "2026-11-01" }, "en-US")).toMatch(
      /Oct 26.*Nov 1, 2026/,
    );
  });
});

describe("comparisons", () => {
  it("is a whole percent, or nothing without a base", () => {
    expect(percentChange(118420, 109650)).toBe(8);
    expect(percentChange(50, 0)).toBeNull();
    expect(percentChange(-20, -10)).toBe(-100);
    expect(formatChange(8)).toBe("▲ 8%");
    expect(formatChange(-3)).toBe("▼ 3%");
    expect(formatChange(0)).toBe("0%");
    expect(formatChange(null)).toBeNull();
  });

  it("reads more spending as bad news and more income as good", () => {
    expect(changeTone(8, "expense")).toBe("bad");
    expect(changeTone(-3, "expense")).toBe("good");
    expect(changeTone(6, "income")).toBe("good");
    expect(changeTone(-11, "net")).toBe("bad");
    expect(changeTone(null, "income")).toBe("neutral");
  });

  it("formats report amounts in whole units", () => {
    expect(formatReportAmount(118420.4, "RUB", "en-US").replace(/\s/g, " ")).toBe("RUB 118,420");
    expect(formatReportAmount(Number.NaN, "XXX1", "en-US")).toBe("0 XXX1");
  });
});

describe("categories", () => {
  const categories = [
    category("food", null, 300),
    category("groceries", "food", 200),
    category("market", "food", 100),
    category("cafe", null, 500),
    category("salary", null, 0, 1000),
  ];

  it("lists a level's categories that moved money, largest first", () => {
    expect(childCategories(categories, null, "expense").map((c) => c.id)).toEqual(["cafe", "food"]);
    expect(childCategories(categories, null, "income").map((c) => c.id)).toEqual(["salary"]);
  });

  it("starts a filtered report from the filter's children, or from the filter itself when it has none", () => {
    expect(topCategories(categories, "food", "expense").map((c) => c.id)).toEqual([
      "groceries",
      "market",
    ]);
    expect(topCategories(categories, "cafe", "expense").map((c) => c.id)).toEqual(["cafe"]);
    expect(topCategories(categories, null, "expense").map((c) => c.id)).toEqual(["cafe", "food"]);
  });
});

describe("squarify", () => {
  it("covers the map exactly, each tile in proportion to its value", () => {
    const values = [6, 6, 4, 3, 2, 2, 1];
    const tiles = squarify(values, (value) => value, 1.5);
    expect(tiles).toHaveLength(values.length);
    const total = values.reduce((sum, value) => sum + value, 0);
    for (const tile of tiles) {
      expect(tile.width * tile.height).toBeCloseTo(tile.item / total, 6);
      expect(tile.x).toBeGreaterThanOrEqual(-1e-9);
      expect(tile.y).toBeGreaterThanOrEqual(-1e-9);
      expect(tile.x + tile.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(tile.y + tile.height).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBeCloseTo(1, 6);
  });

  it("leaves out what has no value", () => {
    expect(squarify([0, -1], (value) => value)).toEqual([]);
    expect(squarify([5, 0], (value) => value)).toHaveLength(1);
  });

  it("shades by rank", () => {
    expect(treemapShade(0, 10)).toBe("strong");
    expect(treemapShade(4, 10)).toBe("medium");
    expect(treemapShade(9, 10)).toBe("light");
    expect(treemapShade(0, 1)).toBe("strong");
  });
});
