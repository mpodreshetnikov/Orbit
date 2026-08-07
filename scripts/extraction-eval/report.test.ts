import { describe, expect, it } from "vitest";
import { renderMarkdown, renderVariance, type RunSummary } from "./report";
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
    const score = scoreCase("001", snapshot(), snapshot(), []);
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
      [],
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
        findings_to_resolve: [
          { finding_code: "polyp", finding_type_text: "полип", site_code: "gallbladder" },
        ],
      }),
      [
        {
          finding_code: "polyp",
          finding_type_text: "полип",
          site_code: "gallbladder",
          body_site_text: "желчный пузырь",
          finding_type_id: "ft-2",
          body_site_id: "bs-2",
        },
      ],
    );
    const markdown = renderMarkdown(
      summary({ cases: [{ caseId: "002", score }], aggregate: aggregate([score]) }),
    );
    const warning = markdown.indexOf("1 wrongful resolution(s)");
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(markdown.indexOf("## Aggregate"));
    expect(markdown).toContain("finding `полип @ gallbladder`");
  });

  it("renders an unscored field as a dash rather than a perfect column", () => {
    // Case 002 hits this for real: when no finding label matches, every finding field sits at
    // 0/0, and ratio() calls an empty denominator 1. Printing that as 100% claims the pipeline
    // got right what it was never asked.
    const score = scoreCase("002", snapshot(), snapshot(), []);
    const markdown = renderMarkdown(
      summary({ cases: [{ caseId: "002", score }], aggregate: aggregate([score]) }),
    );
    const section = markdown.slice(markdown.indexOf("## Finding fields"));
    expect(section).toContain("| `finding_code` | 0 | 0 | — |");
    expect(section.slice(0, section.indexOf("## Cases"))).not.toContain("100.0%");
    expect(markdown).toContain("No finding matched on both sides");
  });

  it("gives findings_to_resolve a row of its own so it cannot be silently unscored", () => {
    const score = scoreCase("002", snapshot(), snapshot(), []);
    const markdown = renderMarkdown(
      summary({ cases: [{ caseId: "002", score }], aggregate: aggregate([score]) }),
    );
    expect(markdown).toContain("| findings_to_resolve |");
  });
});

describe("renderVariance", () => {
  function runOf(observations: CaseSnapshot["observations"]) {
    return aggregate([scoreCase("001", snapshot({ observations }), snapshot(), [])]);
  }

  const observation = {
    obs_name: "Гемоглобин",
    obs_code: "hemoglobin",
    value_numeric: 97,
    unit: "г/л",
    ref_range_low: null,
    ref_range_high: null,
    status: null,
    value_canonical: 97,
    unit_canonical: "g/L",
    is_applied: true,
  };

  it("renders nothing for a single run, because one run has no spread", () => {
    expect(renderVariance([runOf([])])).toBe("");
  });

  it("marks a dimension that agreed across every run as stable", () => {
    const variance = renderVariance([runOf([]), runOf([]), runOf([])]);
    expect(variance).toContain("Variance across 3 runs");
    expect(variance).toContain("stable");
  });

  it("prints the range and every run when a dimension disagreed", () => {
    // Two runs that found different numbers of observations: the recall differs, so the f1 does.
    const variance = renderVariance([runOf([]), runOf([observation])]);
    expect(variance).toContain("observations fn");
    // The individual runs are printed, not just a summary — the point is to show the disagreement.
    expect(variance).toMatch(/observations fn \| 0\.5 \| 0\.0 – 1\.0 \| 0\.0, 1\.0/);
  });
});
