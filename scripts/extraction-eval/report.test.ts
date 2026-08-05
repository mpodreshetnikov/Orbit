import { describe, expect, it } from "vitest";
import { renderMarkdown, type RunSummary } from "./report";
import { aggregate, scoreCase } from "./score";
import type { CaseSnapshot } from "./types";

function snapshot(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    record_type: "lab",
    record_date: "2026-03-06",
    observations: [],
    findings: [],
    conditions: [],
    findings_to_resolve: [],
    conditions_to_resolve: [],
    checkups_to_complete: [],
    ...overrides,
  };
}

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    model: "m",
    mode: "replay",
    generatedAt: "2026-03-06T00:00:00.000Z",
    cases: [],
    aggregate: aggregate([]),
    ...overrides,
  };
}

describe("renderMarkdown", () => {
  it("refuses to render scores when nothing was scored", () => {
    const markdown = renderMarkdown(
      summary({ cases: [{ caseId: "001", error: "cassette miss" }] }),
    );
    // The failure mode this guards: empty sets score as 100%, so a run where every case crashed
    // would otherwise publish a full sheet of perfect numbers.
    expect(markdown).toContain("No cases scored");
    expect(markdown).toContain("cassette miss");
    expect(markdown).not.toContain("100.0%");
  });

  it("says how many cases the numbers actually cover when some failed", () => {
    const score = scoreCase("001", snapshot(), snapshot());
    const markdown = renderMarkdown(
      summary({
        cases: [
          { caseId: "001", score },
          { caseId: "002", error: "boom" },
        ],
        aggregate: aggregate([score]),
      }),
    );
    expect(markdown).toContain("1 scored, 1 failed");
    expect(markdown).toContain("case(s) failed to run");
    expect(markdown).toContain("boom");
  });

  it("leads with wrongful resolutions when there are any", () => {
    const score = scoreCase(
      "001",
      snapshot(),
      snapshot({ conditions_to_resolve: [{ condition_id: "cond-gastritis" }] }),
    );
    const markdown = renderMarkdown(
      summary({ cases: [{ caseId: "001", score }], aggregate: aggregate([score]) }),
    );
    const warning = markdown.indexOf("wrongful condition resolution");
    const table = markdown.indexOf("## Aggregate");
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(table);
    expect(markdown).toContain("cond-gastritis");
  });
});
