import { describe, expect, it } from "vitest";
import {
  formatCost,
  renderMarkdown,
  renderVariance,
  stageTotals,
  totalCost,
  type RunSummary,
} from "./report";
import { aggregate, scoreCase } from "./score";
import type { CaseSnapshot, ExpectedResolution } from "./types";

/** A proposed closure with both scored fields spelled out — see the note in `score.test.ts`. */
function resolution(
  conditionId: string,
  supportingObsCode: string | null = null,
  gateRejection: string | null = null,
): ExpectedResolution {
  return {
    condition_id: conditionId,
    supporting_obs_code: supportingObsCode,
    gate_rejection: gateRejection,
  };
}

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
      snapshot({ conditions_to_resolve: [resolution("cond-gastritis")] }),
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

  it("shows a citation that moved between runs the set score reads as stable", () => {
    // The same condition every pass, cited differently on one of them. `conditions_to_resolve` is
    // identical across both runs and says `stable`; only the field rows show that whether the
    // closure happens at all was not. Only the last pass is rendered in full, so without these
    // rows the swing leaves no trace anywhere in the report.
    const expected = snapshot({ conditions_to_resolve: [resolution("cond-b12", "vitamin_b12")] });
    const cited = aggregate([
      scoreCase(
        "001",
        expected,
        snapshot({ conditions_to_resolve: [resolution("cond-b12", "vitamin_b12")] }),
        [],
      ),
    ]);
    const miscited = aggregate([
      scoreCase(
        "001",
        expected,
        snapshot({ conditions_to_resolve: [resolution("cond-b12", "ferritin")] }),
        [],
      ),
    ]);

    const variance = renderVariance([cited, miscited]);
    expect(variance).toMatch(/conditions_to_resolve f1 \| 100\.0% \| stable/);
    expect(variance).toMatch(
      /condition resolution supporting_obs_code \| 50\.0% \| 0\.0% – 100\.0%/,
    );
    expect(variance).toContain("condition resolution gate_rejection");
  });

  it("omits a resolution field no run compared, rather than calling it stable at 100%", () => {
    // `ratio` returns 1 for 0/0, so an aggregate over cases with no matched resolution carries
    // `accuracy: 1` beside `total: 0`. The field table renders that as a dash; this table would
    // have printed `100.0% | stable` for a dimension nothing ever compared.
    const empty = aggregate([scoreCase("002", snapshot(), snapshot(), [])]);
    const variance = renderVariance([empty, empty]);
    expect(variance).toContain("Variance across 2 runs");
    expect(variance).not.toContain("condition resolution");
  });

  it("says how many runs compared a resolution field when not all of them did", () => {
    const withRow = aggregate([
      scoreCase(
        "001",
        snapshot({ conditions_to_resolve: [resolution("cond-b12", "vitamin_b12")] }),
        snapshot({ conditions_to_resolve: [resolution("cond-b12", "vitamin_b12")] }),
        [],
      ),
    ]);
    const without = aggregate([scoreCase("002", snapshot(), snapshot(), [])]);
    const variance = renderVariance([withRow, without]);
    expect(variance).toContain("condition resolution supporting_obs_code (1 of 2 runs)");
  });
});

describe("cost reporting", () => {
  function withCost(caseId: string, costUsd: number | null) {
    return {
      caseId,
      diagnostics: {
        stagesRun: ["classify"],
        rejected: [],
        droppedInvalidCount: 0,
        unresolvedCatalogCount: 0,
        promptTokens: 10,
        completionTokens: 5,
        costUsd,
      },
    };
  }

  it("prints an unknown price as a dash, never as zero", () => {
    // A replayed cassette carries no price. Rendering that as $0.0000 would claim a live run was
    // free, and the whole point of the field is to be able to trust the total.
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(Number.NaN)).toBe("—");
    expect(formatCost(0)).toBe("$0.0000");
  });

  it("keeps enough precision to distinguish cheap cases", () => {
    // Two decimals would print $0.01 for everything and $0.00 for the rest.
    expect(formatCost(0.0123)).toBe("$0.0123");
    expect(formatCost(1.5)).toBe("$1.5000");
  });

  it("totals only the cases that reported a price, and counts the ones that did not", () => {
    const result = totalCost([withCost("001", 0.01), withCost("002", 0.02), withCost("003", null)]);
    expect(result.total).toBeCloseTo(0.03, 10);
    expect(result.priced).toBe(2);
    // Reporting 2-of-3 as the run's cost without saying so is how a number gets misread.
    expect(result.unpriced).toBe(1);
  });

  it("reports a live run's cost as the run's cost", () => {
    const score = scoreCase("001", snapshot(), snapshot(), []);
    const markdown = renderMarkdown(
      summary({
        mode: "live",
        cases: [{ ...withCost("001", 0.0421), score }],
        aggregate: aggregate([score]),
      }),
    );
    expect(markdown).toContain("$0.0421");
    expect(markdown).toContain("across 1 case(s)");
  });

  it("says a replay's cost is what recording cost, not what the replay cost", () => {
    // Replaying is free and offline. The price on a cassette belongs to the call that recorded it,
    // and printing it unqualified is how it ends up in someone's budget as a recurring cost.
    const score = scoreCase("001", snapshot(), snapshot(), []);
    const markdown = renderMarkdown(
      summary({
        mode: "replay",
        cases: [{ ...withCost("001", 0.0421), score }],
        aggregate: aggregate([score]),
      }),
    );
    expect(markdown).toContain("to record");
    expect(markdown).toContain("replaying them is free");
  });
});

describe("stageTotals", () => {
  const spend = (stage: string, cost: number | null, calls = 1) => ({
    stage,
    calls,
    promptTokens: 10,
    completionTokens: 5,
    costUsd: cost,
  });

  it("adds each stage across cases and keeps them apart", () => {
    expect(
      stageTotals([
        { caseId: "a", stageSpend: [spend("classify", 0.1), spend("extract", 1)] },
        { caseId: "b", stageSpend: [spend("classify", 0.2), spend("extract", 2)] },
      ]),
    ).toEqual([
      {
        stage: "classify",
        calls: 2,
        promptTokens: 20,
        completionTokens: 10,
        costUsd: 0.30000000000000004,
      },
      { stage: "extract", calls: 2, promptTokens: 20, completionTokens: 10, costUsd: 3 },
    ]);
  });

  it("nulls a stage that was unpriced in any case", () => {
    const totals = stageTotals([
      { caseId: "a", stageSpend: [spend("extract", 1)] },
      { caseId: "b", stageSpend: [spend("extract", null)] },
    ]);
    expect(totals[0]).toMatchObject({ calls: 2, costUsd: null });
  });

  // A case that died at reconcile still paid for classify and extract; dropping its spend would
  // understate what the run cost.
  it("counts the spend of a case that failed", () => {
    expect(
      stageTotals([{ caseId: "a", error: "boom", stageSpend: [spend("classify", 0.1)] }]),
    ).toHaveLength(1);
  });
});

describe("renderMarkdown cost by stage", () => {
  it("prints each stage's share of the run", () => {
    const rendered = renderMarkdown(
      summary({
        cases: [
          {
            caseId: "001",
            stageSpend: [
              { stage: "classify", calls: 1, promptTokens: 1, completionTokens: 1, costUsd: 1 },
              { stage: "extract", calls: 1, promptTokens: 1, completionTokens: 1, costUsd: 3 },
            ],
          },
        ],
      }),
    );
    expect(rendered).toContain("## Cost by stage");
    expect(rendered).toContain("25.0%");
    expect(rendered).toContain("75.0%");
  });

  it("omits the share rather than guessing when a stage is unpriced", () => {
    const rendered = renderMarkdown(
      summary({
        cases: [
          {
            caseId: "001",
            stageSpend: [
              { stage: "classify", calls: 1, promptTokens: 1, completionTokens: 1, costUsd: null },
            ],
          },
        ],
      }),
    );
    expect(rendered).toContain("## Cost by stage");
    expect(rendered).not.toContain("100.0%");
  });

  it("is left out entirely when nothing reported a stage", () => {
    expect(renderMarkdown(summary({ cases: [{ caseId: "001" }] }))).not.toContain(
      "## Cost by stage",
    );
  });
});

describe("renderMarkdown cost by stage across passes", () => {
  const one = (cost: number) => ({
    caseId: "001",
    stageSpend: [
      { stage: "extract", calls: 1, promptTokens: 1, completionTokens: 1, costUsd: cost },
    ],
  });

  // `cases` is only the pass rendered in full, but every pass was paid for and the `## Cost`
  // section totals them all. A per-stage table covering one third of a --repeat 3 run would
  // contradict it.
  it("totals spend from every pass, not just the rendered one", () => {
    const rendered = renderMarkdown(
      summary({ cases: [one(1)], spendCases: [one(1), one(1), one(1)], passCount: 3 }),
    );
    expect(rendered).toContain("$3.0000");
    expect(rendered).toContain("across 3 passes");
  });

  it("falls back to the rendered pass when no pass set is given", () => {
    expect(renderMarkdown(summary({ cases: [one(2)] }))).toContain("$2.0000");
  });

  // A replay's dollars are the recording's, and the no-cases-scored guard can return before the
  // aggregate cost line that would otherwise say so.
  it("labels replayed costs as recording costs", () => {
    const rendered = renderMarkdown(summary({ cases: [one(1)], mode: "replay" }));
    expect(rendered).toContain("Cost by stage (to record these cassettes)");
    expect(rendered).toContain("Replaying is free");
  });

  it("says a live run measured itself", () => {
    expect(renderMarkdown(summary({ cases: [one(1)], mode: "live" }))).toContain(
      "Measured on this run",
    );
  });
});
