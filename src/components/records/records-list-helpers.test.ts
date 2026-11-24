import { describe, expect, it } from "vitest";
import {
  TAB_VALUES,
  countOrZero,
  hasActiveFilters,
  recordTypeFilterParam,
  searchFilterParam,
  sideFilterPersonId,
  tabFromSearchParams,
} from "./records-list-helpers";

describe("records-list-helpers", () => {
  it("parses tab and legacy showDrafts from search params", () => {
    expect(TAB_VALUES).toEqual(["active", "draft", "processing", "removed"]);
    expect(tabFromSearchParams(new URLSearchParams("tab=draft"))).toBe("draft");
    expect(tabFromSearchParams(new URLSearchParams("tab=nope"))).toBe("active");
    expect(tabFromSearchParams(new URLSearchParams("showDrafts=true"))).toBe("draft");
    expect(tabFromSearchParams(new URLSearchParams())).toBe("active");
  });

  it("counts results before and after a query resolves", () => {
    expect(countOrZero(null)).toBe(0);
    expect(countOrZero(undefined)).toBe(0);
    expect(countOrZero([])).toBe(0);
    expect(countOrZero([1, 2])).toBe(2);
  });

  it("detects active filters", () => {
    expect(hasActiveFilters("", "all", "active")).toBe(false);
    expect(hasActiveFilters("x", "all", "active")).toBe(true);
    expect(hasActiveFilters("", "lab", "active")).toBe(true);
    expect(hasActiveFilters("", "all", "draft")).toBe(true);
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
