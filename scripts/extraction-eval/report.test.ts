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
    const warning = markdown.indexOf("wrongful resolution");
    const table = markdown.indexOf("## Aggregate");
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(table);
    expect(markdown).toContain("cond-gastritis");
  });

  it("leads with a wrongfully closed finding too, not only a condition", () => {
    // A finding closed on evidence the document does not carry is the same class of harm as a
    // condition closed the same way, so it has to reach the same banner.
    const score = scoreCase(
      "002",
      snapshot(),
      snapshot({
        findings_to_resolve: [{ finding_type_text: "полип", site_code: "gallbladder" }],
      }),
    );
    const markdown = renderMarkdown(
      summary({ cases: [{ caseId: "002", score }], aggregate: aggregate([score]) }),
    );
    const warning = markdown.indexOf("1 wrongful resolution(s)");
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(markdown.indexOf("## Aggregate"));
    expect(markdown).toContain("finding `полип @ gallbladder`");
  });

  it("gives findings_to_resolve a row of its own so it cannot be silently unscored", () => {
    const score = scoreCase("002", snapshot(), snapshot());
    const markdown = renderMarkdown(
      summary({ cases: [{ caseId: "002", score }], aggregate: aggregate([score]) }),
    );
    expect(markdown).toContain("| findings_to_resolve |");
  });
});
