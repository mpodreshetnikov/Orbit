import { describe, expect, it } from "vitest";
import type { ConditionWithHistory } from "./condition";
import {
  conditionSections,
  conditionTimeline,
  mentionDecidesStatus,
  searchConditions,
} from "./condition-summary";

const condition = (overrides: Partial<ConditionWithHistory>): ConditionWithHistory => ({
  id: "c",
  person_id: "p",
  name: "Анемия",
  icd_name_en: null,
  icd_name_ru: null,
  code: null,
  current_status: "active",
  onset_date: null,
  resolved_date: null,
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  mention_count: 0,
  first_mentioned_date: null,
  last_mentioned_date: null,
  ...overrides,
});

describe("searchConditions", () => {
  const list = [
    condition({ id: "a", name: "Анемия", code: "D50.9", icd_name_en: "Iron deficiency anaemia" }),
    condition({ id: "b", name: "Гастрит" }),
  ];

  it("keeps everything for a blank query", () => {
    expect(searchConditions(list, "  ")).toBe(list);
  });

  it("matches the name, the ICD name and the code, ignoring case", () => {
    expect(searchConditions(list, "гастр").map((c) => c.id)).toEqual(["b"]);
    expect(searchConditions(list, "IRON").map((c) => c.id)).toEqual(["a"]);
    expect(searchConditions(list, "d50").map((c) => c.id)).toEqual(["a"]);
  });
});

describe("conditionSections", () => {
  it("groups by status in page order, most recently mentioned first, undated last", () => {
    const sections = conditionSections([
      condition({ id: "old", last_mentioned_date: "2025-01-01" }),
      condition({ id: "never" }),
      condition({ id: "new", last_mentioned_date: "2026-03-01" }),
      condition({ id: "gone", current_status: "resolved" }),
    ]);
    expect(sections.map((s) => [s.status, s.items.map((c) => c.id)])).toEqual([
      ["active", ["new", "old", "never"]],
      ["suspected", []],
      ["resolved", ["gone"]],
      ["history", []],
    ]);
  });
});

describe("conditionTimeline", () => {
  it("orders mentions newest first by record date, else by when written, and counts them", () => {
    const timeline = conditionTimeline([
      { id: "1", record_date: "2025-05-01", created_at: "2026-01-01T00:00:00Z" },
      { id: "2", record_date: null, created_at: "2025-08-01T00:00:00Z" },
      { id: "3", record_date: "2026-02-01", created_at: "2026-02-02T00:00:00Z" },
      { id: "4", record_date: null, created_at: "" },
      { id: "5", record_date: null, created_at: "" },
    ]);
    expect(timeline.history.map((m) => m.id)).toEqual(["3", "2", "1", "4", "5"]);
    expect(timeline).toMatchObject({
      mention_count: 5,
      first_mentioned_date: "2025-05-01",
      last_mentioned_date: "2026-02-01",
    });
  });

  it("has no dates without mentions", () => {
    expect(conditionTimeline([])).toEqual({
      history: [],
      mention_count: 0,
      first_mentioned_date: null,
      last_mentioned_date: null,
    });
  });
});

describe("mentionDecidesStatus", () => {
  it("lets a dated mention decide when it is the newest word", () => {
    expect(mentionDecidesStatus("2026-02-01", null)).toBe(true);
    expect(mentionDecidesStatus("2026-02-01", "2026-02-01")).toBe(true);
    expect(mentionDecidesStatus("2026-01-01", "2026-02-01")).toBe(false);
    expect(mentionDecidesStatus(null, null)).toBe(false);
  });
});
