import { describe, expect, it } from "vitest";
import type { FindingSummary } from "./finding";
import {
  findingKey,
  resolvedFindingRow,
  searchFindingSummaries,
  summarizeFindings,
  type FindingListRow,
} from "./finding-summary";

function row(id: string, date: string, extra: Partial<FindingListRow> = {}): FindingListRow {
  return {
    id,
    record_id: "rec",
    finding_type_id: null,
    finding_code: "cyst",
    finding_type_text: "Cyst",
    body_site_id: null,
    site_code: "kidney_left",
    body_site_text: "Left kidney",
    size_mm: null,
    count: null,
    resolution_status: "observed",
    severity: "mild",
    laterality: "left",
    morphology: null,
    description: null,
    histology: null,
    source_anchor: "",
    created_at: `${date}T00:00:00Z`,
    medical_records: { person_id: "p", record_date: date, status: "active" },
    finding_type_catalog: null,
    body_site_catalog: null,
    ...extra,
  };
}

describe("summarizeFindings", () => {
  it("groups by finding and site, newest first, keeping the latest known size", () => {
    const [cyst] = summarizeFindings([
      row("a", "2025-01-01", { size_mm: 10, count: 1 }),
      row("b", "2026-01-01"),
    ]);
    expect(cyst.history.map((point) => point.id)).toEqual(["b", "a"]);
    expect([cyst.latest_size_mm, cyst.latest_count, cyst.occurrence_count]).toEqual([10, 1, 2]);
    expect(cyst.is_resolved).toBe(false);
  });

  it("is resolved when its latest row says so, and orders the severe first", () => {
    const summaries = summarizeFindings([
      row("a", "2025-01-01", { finding_code: null, finding_type_text: "Polyp " }),
      row("b", "2026-01-01", {
        finding_code: null,
        finding_type_text: "polyp",
        resolution_status: "resolved",
      }),
      row("c", "2024-01-01", { finding_code: "stone", severity: "severe" }),
    ]);
    expect(summaries.map((s) => [s.finding_code ?? s.finding_type_text, s.is_resolved])).toEqual([
      ["stone", false],
      ["Polyp ", true],
    ]);
  });
});

describe("findingKey", () => {
  it("falls back to the written text and an unknown site", () => {
    expect(
      findingKey({
        finding_code: null,
        finding_type_text: " Polyp",
        site_code: null,
        body_site_text: null,
      }),
    ).toBe("polyp::unknown");
  });
});

describe("searchFindingSummaries and resolvedFindingRow", () => {
  const [cyst] = summarizeFindings([
    row("a", "2025-01-01", { body_site_catalog: { name_ru: "Левая почка", name_en: null } }),
  ]);

  it("matches a catalogue name and leaves a blank search alone", () => {
    expect(searchFindingSummaries([cyst], "почка")).toEqual([cyst]);
    expect(searchFindingSummaries([cyst], "liver")).toEqual([]);
    expect(searchFindingSummaries([cyst], "")).toEqual([cyst]);
  });

  it("writes the row that marks it gone", () => {
    expect(resolvedFindingRow("p", "rec-2", cyst as FindingSummary)).toMatchObject({
      record_id: "rec-2",
      finding_code: "cyst",
      resolution_status: "resolved",
      size_mm: null,
      laterality: "left",
    });
  });
});
