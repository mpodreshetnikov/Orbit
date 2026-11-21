import { describe, expect, it } from "vitest";
import {
  TAB_VALUES,
  countOrZero,
  emptyBodyKey,
  emptyIconKind,
  emptyTitleKey,
  hasActiveFilters,
  recordTypeFilterParam,
  searchFilterParam,
  showCountBadge,
  sideFilterPersonId,
  tabButtonVariant,
  tabFromSearchParams,
  tabNeedsAccent,
} from "./records-list-helpers";

describe("records-list-helpers", () => {
  it("parses tab and legacy showDrafts from search params", () => {
    expect(TAB_VALUES).toEqual(["active", "draft", "processing", "removed"]);
    expect(TAB_VALUES).toHaveLength(4);
    expect(tabFromSearchParams(new URLSearchParams("tab=draft"))).toBe("draft");
    expect(tabFromSearchParams(new URLSearchParams("tab=nope"))).toBe("active");
    expect(tabFromSearchParams(new URLSearchParams("showDrafts=true"))).toBe("draft");
    expect(tabFromSearchParams(new URLSearchParams())).toBe("active");
  });

  it("counts and tab chrome helpers", () => {
    expect(countOrZero(null)).toBe(0);
    expect(countOrZero(undefined)).toBe(0);
    expect(countOrZero([])).toBe(0);
    expect(countOrZero([1, 2])).toBe(2);
    expect(tabButtonVariant(true)).toBe("secondary");
    expect(tabButtonVariant(false)).toBe("ghost");
    expect(tabNeedsAccent(0, false)).toBe(false);
    expect(tabNeedsAccent(1, true)).toBe(false);
    expect(tabNeedsAccent(1, false)).toBe(true);
    expect(showCountBadge(0)).toBe(false);
    expect(showCountBadge(2)).toBe(true);
  });

  it("detects active filters and empty-state copy keys", () => {
    expect(hasActiveFilters("", "all", "active")).toBe(false);
    expect(hasActiveFilters("x", "all", "active")).toBe(true);
    expect(hasActiveFilters("", "lab", "active")).toBe(true);
    expect(hasActiveFilters("", "all", "draft")).toBe(true);

    expect(emptyTitleKey("active", false)).toBe("health.noRecords");
    expect(emptyBodyKey("active", false)).toBe("health.noRecordsViaAssistant");
    expect(emptyTitleKey("draft", true)).toBe("records.noDrafts");
    expect(emptyBodyKey("draft", true)).toBe("records.noDraftsDescription");
    expect(emptyTitleKey("processing", true)).toBe("records.noNotProcessed");
    expect(emptyBodyKey("processing", true)).toBe("records.noNotProcessedDescription");
    expect(emptyTitleKey("removed", true)).toBe("common.noResults");
    expect(emptyBodyKey("removed", true)).toBe("common.noResults");
    expect(emptyIconKind("draft")).toBe("draft");
    expect(emptyIconKind("processing")).toBe("notProcessed");
    expect(emptyIconKind("active")).toBe("default");
  });

  it("builds list query params and side-filter person ids", () => {
    expect(recordTypeFilterParam("all")).toBeUndefined();
    expect(recordTypeFilterParam("lab")).toBe("lab");
    expect(searchFilterParam("  ")).toBeUndefined();
    expect(searchFilterParam("  cbc ")).toBe("cbc");
    expect(sideFilterPersonId("draft", "draft", "p1")).toBe("");
    expect(sideFilterPersonId("active", "draft", "p1")).toBe("p1");
    expect(sideFilterPersonId("processing", "processing", "p1")).toBe("");
  });
});
