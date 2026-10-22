import { describe, expect, it } from "vitest";
import {
  isAbnormal,
  searchObservationSummaries,
  summarizeObservations,
  type ObservationListRow,
} from "./observation-summary";

function row(
  id: string,
  code: string | null,
  name: string,
  date: string | null,
  extra: Partial<ObservationListRow> = {},
): ObservationListRow {
  return {
    id,
    record_id: "r",
    obs_code: code,
    obs_name: name,
    catalog_id: null,
    value_numeric: 1,
    value_text: null,
    value_canonical: null,
    unit: "u",
    unit_canonical: null,
    ref_range_low: null,
    ref_range_high: null,
    ref_range_low_canonical: null,
    ref_range_high_canonical: null,
    status: "normal",
    created_at: "2026-01-01T00:00:00Z",
    medical_records: { person_id: "p", record_date: date, status: "active" },
    observation_catalog: null,
    ...extra,
  };
}

describe("summarizeObservations", () => {
  it("groups by code, or by name without one, with the history oldest first", () => {
    const [glucose, urine] = summarizeObservations([
      row("b", "glucose", "Glucose", "2026-03-01"),
      row("a", "glucose", "Glucose", "2026-01-01"),
      row("c", null, " Urine Colour ", null),
    ]);
    expect(glucose.history.map((point) => point.id)).toEqual(["a", "b"]);
    expect(glucose.measurement_count).toBe(2);
    expect(urine.obs_code).toBe("urine colour");
  });

  it("puts out-of-range values first, then the newest, then by name", () => {
    const codes = summarizeObservations([
      row("1", "b", "B", "2026-01-01"),
      row("2", "a", "A", "2026-01-01"),
      row("3", "new", "New", "2026-05-01"),
      row("4", "low", "Low", "2025-01-01", { status: "low" }),
    ]).map((summary) => summary.obs_code);
    expect(codes).toEqual(["low", "new", "a", "b"]);
  });

  it("takes the catalogue's names, unit and default range", () => {
    const [summary] = summarizeObservations([
      row("1", "hgb", "Hb", "2026-01-01", {
        value_canonical: 140,
        unit_canonical: "g/L",
        observation_catalog: {
          name_ru: "Гемоглобин",
          name_en: "Hemoglobin",
          canonical_unit: "г/л",
          default_ref_low: 130,
          default_ref_high: 170,
        },
      }),
    ]);
    expect(summary).toMatchObject({
      catalog_name_ru: "Гемоглобин",
      canonical_unit: "г/л",
      latest_value: 140,
      latest_unit: "g/L",
      default_ref_low: 130,
    });
  });
});

describe("searchObservationSummaries", () => {
  const summaries = summarizeObservations([
    row("1", "hgb", "Hb", "2026-01-01", {
      observation_catalog: {
        name_ru: "Гемоглобин",
        name_en: null,
        canonical_unit: null,
        default_ref_low: null,
        default_ref_high: null,
      },
    }),
    row("2", "glucose", "Glucose", "2026-01-01"),
  ]);

  it("matches the name, the code or a catalogue name", () => {
    expect(searchObservationSummaries(summaries, "гемо").map((s) => s.obs_code)).toEqual(["hgb"]);
    expect(searchObservationSummaries(summaries, "GLU").map((s) => s.obs_code)).toEqual([
      "glucose",
    ]);
    expect(searchObservationSummaries(summaries, " ")).toBe(summaries);
  });
});

describe("isAbnormal", () => {
  it("is true only for a status out of range", () => {
    expect([
      isAbnormal("high"),
      isAbnormal("normal"),
      isAbnormal("unknown"),
      isAbnormal(null),
    ]).toEqual([true, false, false, false]);
  });
});
