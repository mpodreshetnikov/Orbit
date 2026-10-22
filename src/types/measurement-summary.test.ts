import { describe, expect, it } from "vitest";
import {
  normalizeMeasurementCategory,
  searchMeasurementSummaries,
  summarizeMeasurements,
  type MeasurementListRow,
} from "./measurement-summary";

function row(
  id: string,
  code: string,
  value: number,
  measuredAt: string,
  extra: Partial<NonNullable<MeasurementListRow["measurement_catalog"]>> = {},
): MeasurementListRow {
  return {
    id,
    catalog_id: `cat-${code}`,
    value,
    measured_at: measuredAt,
    notes: null,
    created_at: measuredAt,
    measurement_catalog: {
      code,
      name_ru: code,
      name_en: code,
      unit_ru: "см",
      unit_en: "cm",
      category: "body",
      sort_order: 0,
      ...extra,
    },
  };
}

describe("summarizeMeasurements", () => {
  it("groups by code, keeps the newest as latest and orders history oldest first", () => {
    const [weight] = summarizeMeasurements([
      row("b", "weight", 81, "2026-10-02T08:00:00Z", { category: "basic" }),
      row("a", "weight", 80, "2026-10-01T08:00:00Z", { category: "basic" }),
    ]);

    expect(weight.latest_value).toBe(81);
    expect(weight.latest_date).toBe("2026-10-02T08:00:00Z");
    expect(weight.measurement_count).toBe(2);
    expect(weight.history.map((point) => point.id)).toEqual(["a", "b"]);
  });

  it("drops rows without a catalog entry and sorts by category, then pairs", () => {
    const orphan = { ...row("x", "gone", 1, "2026-10-01T00:00:00Z"), measurement_catalog: null };
    const codes = summarizeMeasurements([
      row("1", "bicep_right", 30, "2026-10-01T00:00:00Z", { category: "limbs" }),
      orphan,
      row("2", "bicep_left", 31, "2026-10-01T00:00:00Z", { category: "limbs" }),
      row("3", "weight", 80, "2026-10-01T00:00:00Z", { category: "basic" }),
    ]).map((summary) => summary.code);

    expect(codes).toEqual(["weight", "bicep_left", "bicep_right"]);
  });

  it("returns nothing for no rows", () => {
    expect(summarizeMeasurements([])).toEqual([]);
  });
});

describe("normalizeMeasurementCategory", () => {
  it("keeps a known category and falls back to basic", () => {
    expect(normalizeMeasurementCategory("vital")).toBe("vital");
    expect(normalizeMeasurementCategory("other")).toBe("basic");
  });
});

describe("searchMeasurementSummaries", () => {
  const items = [
    { code: "weight", name_ru: "Вес", name_en: "Weight" },
    { code: "waist", name_ru: "Талия", name_en: "Waist" },
  ];

  it("matches the code or either name, ignoring case", () => {
    expect(searchMeasurementSummaries(items, " вес ")).toEqual([items[0]]);
    expect(searchMeasurementSummaries(items, "WAI")).toEqual([items[1]]);
    expect(searchMeasurementSummaries(items, "eigh")).toEqual([items[0]]);
  });

  it("returns everything for a blank search", () => {
    expect(searchMeasurementSummaries(items, "  ")).toBe(items);
    expect(searchMeasurementSummaries(items, undefined)).toBe(items);
  });
});
