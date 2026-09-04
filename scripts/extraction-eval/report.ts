/** Rendering only — pure, so the shape of a report can be asserted without running an eval. */
import type { StageSpend } from "./cassette.ts";
import { RESOLUTION_FIELDS } from "./score.ts";
import type { Aggregate, CaseScore, FieldAccuracy, SetScore } from "./score.ts";
import type { CaseDiagnostics } from "./types.ts";

export interface CaseResult {
  caseId: string;
  score?: CaseScore;
  diagnostics?: CaseDiagnostics;
  /**
   * Per-stage split of what this case spent. Present even when the case failed, because a case
   * that died at reconcile still paid for classify and extract, and hiding that would understate
   * the run.
   */
  stageSpend?: StageSpend[];
  error?: string;
}

export interface RunSummary {
  model: string;
  mode: string;
  generatedAt: string;
  cases: CaseResult[];
  /**
   * Every case of every pass, where `cases` is only the pass rendered in full.
   *
   * Spend and scores are summarised over different sets on a `--repeat` run, deliberately: one
   * pass is rendered because showing N sets of scores would be unreadable, but all N were paid
   * for. Defaults to `cases` when absent, which is correct for a single pass.
   */
  spendCases?: CaseResult[];
  /** How many passes ran, so the cost table can say what it is totalling. */
  passCount?: number;
  aggregate: Aggregate;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Spread across repeated runs of the same corpus, so a change can be told apart from a resample.
 *
 * This exists because single runs of this corpus were being over-read. Five live runs of case 002
 * disagreed on observations (0, 3, 3, 2, 3), findings (3, 3, 3, 4, 2), conditions (1, 2, 2, 0, 2)
 * and anchor rejections (0, 0, 0, 3, 2) — only one dimension was stable across all five. Run-to-run
 * variance is larger than most of the differences people were arguing about, so a single number
 * moving proves nothing on its own.
 *
 * Min and max rather than a standard deviation: at the run counts anyone will actually use (3, 5),
 * a standard deviation is a worse summary of three numbers than the three numbers' range, and it
 * invites the false precision this section exists to prevent.
 */
export interface VarianceRow {
  dimension: string;
  values: number[];
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((n, v) => n + v, 0) / values.length;
}

function varianceRow(row: VarianceRow, format: (value: number) => string): string {
  const min = Math.min(...row.values);
  const max = Math.max(...row.values);
  const spread = min === max ? "stable" : `${format(min)} – ${format(max)}`;
  return `| ${row.dimension} | ${format(mean(row.values))} | ${spread} | ${row.values.map(format).join(", ")} |`;
}

export function renderVariance(runs: Aggregate[]): string {
  if (runs.length < 2) return "";
  const sets: [string, (a: Aggregate) => SetScore][] = [
    ["observations", (a) => a.observations],
    ["findings", (a) => a.findings],
    ["conditions", (a) => a.conditions],
    ["findings_to_resolve", (a) => a.findingsToResolve],
    ["conditions_to_resolve", (a) => a.conditionsToResolve],
    ["checkups_to_complete", (a) => a.checkupsToComplete],
  ];

  const lines: string[] = [`## Variance across ${runs.length} runs`, ""];
  lines.push(
    ...table(
      ["dimension", "mean", "spread", "runs"],
      sets.flatMap(([label, pick]) => [
        varianceRow({ dimension: `${label} f1`, values: runs.map((a) => pick(a).f1) }, (value) =>
          pct(value),
        ),
        varianceRow({ dimension: `${label} tp`, values: runs.map((a) => pick(a).tp) }, (value) =>
          value.toFixed(1),
        ),
        varianceRow({ dimension: `${label} fp`, values: runs.map((a) => pick(a).fp) }, (value) =>
          value.toFixed(1),
        ),
        varianceRow({ dimension: `${label} fn`, values: runs.map((a) => pick(a).fn) }, (value) =>
          value.toFixed(1),
        ),
      ]),
    ),
  );
  lines.push("");
  lines.push(
    ...table(
      ["dimension", "mean", "spread", "runs"],
      [
        varianceRow(
          {
            dimension: "wrongful resolutions",
            values: runs.map((a) => a.wrongfulResolutions),
          },
          (value) => value.toFixed(1),
        ),
        // The set metrics above cannot see this. A run that names the same condition every pass but
        // cites a different analyte on one of them -- or cites one production's gate then rejects --
        // is stable on `conditions_to_resolve` and unstable on whether the closure happens at all.
        // Only the last pass is rendered in full, so without these rows that swing leaves no trace.
        //
        // Only runs that actually compared the field are read. `ratio` returns 1 for 0/0, so an
        // aggregate over cases with no matched resolution carries `accuracy: 1` beside `total: 0` --
        // which the field table renders as an honest dash and this table would have printed as
        // `100.0% stable`. A dimension nothing compared must not read as a dimension that agreed.
        ...RESOLUTION_FIELDS.flatMap((field) => {
          const compared = runs
            .flatMap((a) => a.conditionResolutionFields.filter((e) => e.field === String(field)))
            .filter((entry) => entry.total > 0);
          if (compared.length === 0) return [];
          const label =
            compared.length === runs.length
              ? `condition resolution ${String(field)}`
              : `condition resolution ${String(field)} (${compared.length} of ${runs.length} runs)`;
          return [
            varianceRow({ dimension: label, values: compared.map((e) => e.accuracy) }, (value) =>
              pct(value),
            ),
          ];
        }),
      ],
    ),
  );
  lines.push("");
  lines.push(
    "> A dimension reading `stable` agreed across every run. Anything with a spread cannot be " +
      "read off a single run — compare spreads, not single numbers.",
  );
  lines.push("");
  return lines.join("\n");
}

function prRow(label: string, score: SetScore): string {
  return `| ${label} | ${score.tp} | ${score.fp} | ${score.fn} | ${pct(score.precision)} | ${pct(score.recall)} | ${pct(score.f1)} |`;
}

function table(headers: string[], rows: string[]): string[] {
  return [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows];
}

/**
 * A field nothing was scored on reads `—`, never `100.0%`.
 *
 * `ratio()` returns 1 for an empty denominator, which is right for a set score and actively
 * misleading here: a findings row whose labels never matched leaves every field at 0/0, and
 * printing that as a perfect column claims the pipeline got right what it was never asked. Same
 * trap the run-level "no cases scored" guard exists for, one level down.
 */
function fieldSection(title: string, noun: string, fields: FieldAccuracy[]): string[] {
  const lines: string[] = [`## ${title} (matched rows only)`, ""];
  lines.push(
    ...table(
      ["field", "correct", "total", "accuracy"],
      fields.map(
        (field) =>
          `| \`${field.field}\` | ${field.correct} | ${field.total} | ${field.total === 0 ? "—" : pct(field.accuracy)} |`,
      ),
    ),
  );
  lines.push("");

  if (fields.every((field) => field.total === 0)) {
    lines.push(
      `> No ${noun} matched on both sides, so nothing here was compared. Not a perfect score.`,
    );
    lines.push("");
  }

  const mismatches = fields.flatMap((field) => field.mismatches);
  if (mismatches.length > 0) {
    lines.push(`<details><summary>${title} mismatches</summary>`);
    lines.push("");
    lines.push(
      ...table(
        [noun, "field", "expected", "actual"],
        mismatches.map(
          (m) =>
            `| ${m.key} | \`${m.field}\` | \`${JSON.stringify(m.expected)}\` | \`${JSON.stringify(m.actual)}\` |`,
        ),
      ),
    );
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }
  return lines;
}

/**
 * Money, or an honest blank.
 *
 * Four decimal places because a single case costs a few cents and rounding to two would print
 * `$0.01` for everything and `$0.00` for the cheap ones. `—` rather than `$0.0000` when the price
 * is unknown: a replayed cassette carries no price, and printing zero would quietly claim a live
 * run was free.
 */
export function formatCost(costUsd: number | null | undefined): string {
  return typeof costUsd === "number" && Number.isFinite(costUsd) ? `$${costUsd.toFixed(4)}` : "—";
}

/**
 * Total spend across the cases that reported one, plus how many did not.
 *
 * The count matters: a total over two of three cases is not the run's cost, and saying so is the
 * difference between a number someone can act on and one they will misread.
 */
export function totalCost(cases: CaseResult[]): {
  total: number;
  priced: number;
  unpriced: number;
} {
  let total = 0;
  let priced = 0;
  let unpriced = 0;
  for (const result of cases) {
    const cost = result.diagnostics?.costUsd;
    if (typeof cost === "number" && Number.isFinite(cost)) {
      total += cost;
      priced += 1;
    } else if (result.diagnostics) {
      unpriced += 1;
    }
  }
  return { total, priced, unpriced };
}

/**
 * Roll the per-stage spend of every case into one table's worth of rows.
 *
 * This is what a per-stage model decision is actually read off. A stage's share of the bill is the
 * number that says whether pointing it at a cheaper model is worth anything: moving the stage that
 * carries 5% of the cost saves 5% of it at best, however much cheaper the model is.
 *
 * `costUsd` goes null for a stage as soon as one of its calls was unpriced, for the reason on
 * `CaseDiagnostics.costUsd` — a partial total presented as a whole one understates the run.
 */
export function stageTotals(cases: CaseResult[]): StageSpend[] {
  const totals = new Map<string, StageSpend>();
  for (const result of cases) {
    for (const entry of result.stageSpend ?? []) {
      const current = totals.get(entry.stage);
      if (!current) {
        totals.set(entry.stage, { ...entry });
        continue;
      }
      const merge = (a: number | null, b: number | null): number | null =>
        a === null || b === null ? null : a + b;
      current.calls += entry.calls;
      current.promptTokens = merge(current.promptTokens, entry.promptTokens);
      current.completionTokens = merge(current.completionTokens, entry.completionTokens);
      current.costUsd = merge(current.costUsd, entry.costUsd);
    }
  }
  return [...totals.values()];
}

/**
 * The per-stage cost table, with each stage's share of the run.
 *
 * The share is omitted, rather than guessed, when any stage is unpriced: a percentage of a total
 * that is missing one of its parts is a wrong number wearing a precise format.
 */
function stageCostSection(cases: CaseResult[], mode: string, passCount: number): string {
  const stages = stageTotals(cases);
  if (stages.length === 0) return "";
  // A replayed cassette carries the price of the call that recorded it. The aggregate cost line
  // says so, but the no-cases-scored guard can return before that line is ever reached, which
  // would leave these the report's only dollar figures with nothing marking them as historical.
  const replayed = mode === "replay";
  const scope = passCount > 1 ? ` across ${passCount} passes` : "";
  const priced = stages.every((entry) => typeof entry.costUsd === "number");
  const total = priced ? stages.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0) : null;
  const share = (cost: number | null): string =>
    total !== null && total > 0 && cost !== null ? `${((cost / total) * 100).toFixed(1)}%` : "—";
  return [
    replayed ? "## Cost by stage (to record these cassettes)" : "## Cost by stage",
    "",
    replayed
      ? `> Replaying is free. These are the prices of the calls that **recorded** the cassettes${scope}, not of this run.`
      : `> Measured on this run${scope}.`,
    "",
    "| stage | calls | prompt | completion | cost | share |",
    "|---|---|---|---|---|---|",
    ...stages.map(
      (entry) =>
        `| \`${entry.stage}\` | ${entry.calls} | ${entry.promptTokens ?? "?"} | ` +
        `${entry.completionTokens ?? "?"} | ${formatCost(entry.costUsd)} | ${share(entry.costUsd)} |`,
    ),
    `| **total** | ${stages.reduce((sum, entry) => sum + entry.calls, 0)} | | | ` +
      `**${formatCost(total)}** | |`,
    "",
    "> Which stage is worth moving to a cheaper model is read off the share column, not off the",
    "> model's price: a stage carrying 5% of the bill saves at most 5% however cheap it gets.",
    "",
  ].join("\n");
}

/**
 * What the run cost, and on a replay, whose cost it actually is.
 *
 * A replayed cassette carries the price of the call that *recorded* it, which is worth printing --
 * it is what those answers cost to obtain -- but it is emphatically not what the replay cost, since
 * replaying is free and offline. Saying "recorded" is the whole difference between a useful number
 * and one someone will add to a budget by mistake.
 */
function costLine(cases: CaseResult[], mode: string): string {
  const { total, priced, unpriced } = totalCost(cases);
  if (priced === 0) {
    return "- cost: — (no case reported a price)";
  }
  const caveat = unpriced > 0 ? ` · ${unpriced} case(s) unpriced and not included` : "";
  if (mode === "replay") {
    return (
      `- cost: **${formatCost(total)}** to record these ${priced} cassette(s) — ` +
      `replaying them is free${caveat}`
    );
  }
  return `- **cost: ${formatCost(total)}** across ${priced} case(s)${caveat}`;
}

export function renderMarkdown(summary: RunSummary): string {
  const lines: string[] = [];
  const { aggregate: agg } = summary;

  const failed = summary.cases.filter((result) => result.error);

  lines.push("# Extraction eval");
  lines.push("");
  lines.push(
    `Model \`${summary.model}\` · mode \`${summary.mode}\` · ${agg.cases} scored, ${failed.length} failed · ${summary.generatedAt}`,
  );
  lines.push("");

  // Ahead of the no-cases-scored guard below, because spend is not a score. A run where every case
  // crashed still paid for the stages that ran before the crash, and that is exactly when the
  // question "what did this cost me" is hardest to answer from anywhere else — a case that fails is
  // reported unpriced by `costUsd`, so without this the money simply disappears from the report.
  const byStage = stageCostSection(
    summary.spendCases ?? summary.cases,
    summary.mode,
    summary.passCount ?? 1,
  );
  if (byStage) lines.push(byStage);

  // An empty set scores as perfect by convention, which is right per-category and catastrophic in
  // aggregate: a run where every case crashed would otherwise render as 100% across the board.
  // Refuse to print the tables at all rather than publish a number that means nothing.
  if (agg.cases === 0) {
    lines.push(
      `> **No cases scored.** ${failed.length} case(s) failed to run, so there are no results ` +
        `here — not a perfect score. Fix the failures below and re-run.`,
    );
    lines.push("");
    for (const result of failed) {
      lines.push(`> - \`${result.caseId}\`: ${result.error}`);
    }
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  if (failed.length > 0) {
    lines.push(
      `> **${failed.length} case(s) failed to run** and are excluded from every number below, ` +
        `which therefore covers only ${agg.cases} case(s).`,
    );
    lines.push("");
    for (const result of failed) {
      lines.push(`> - \`${result.caseId}\`: ${result.error}`);
    }
    lines.push("");
  }

  // Wrongful closures lead, always. A missed resolution leaves a stale row someone can correct;
  // a wrongful one silently closes a live condition in a patient's record. Averaging the two into
  // one F1 hides exactly the error that matters.
  if (agg.wrongfulResolutions > 0) {
    lines.push(
      `> **${agg.wrongfulResolutions} wrongful resolution(s).** These close a live condition or ` +
        `finding that the document does not support. Investigate before any other number here.`,
    );
    lines.push("");
    for (const id of agg.conditionsToResolve.falsePositives) {
      lines.push(`> - condition \`${id}\``);
    }
    for (const label of agg.findingsToResolve.falsePositives) {
      lines.push(`> - finding \`${label}\``);
    }
    lines.push("");
  } else {
    lines.push("> No wrongful resolutions.");
    lines.push("");
  }

  // Beneath the harm number and deliberately not inside it. These closed nothing -- production's
  // gate refused them, so no chart moved -- but the model still proposed ending a live entry, and a
  // run whose rejections climb is a run getting worse behind a floor that happens to hold.
  if (agg.rejectedProposals.length > 0) {
    lines.push(
      `> ${agg.rejectedProposals.length} proposal(s) production's gate refused, so they closed ` +
        `nothing. Not harm — but the model proposed them.`,
    );
    lines.push("");
    for (const proposal of agg.rejectedProposals) {
      lines.push(`> - condition \`${proposal.conditionId}\` — \`${proposal.reason}\``);
    }
    lines.push("");
  }

  lines.push("## Aggregate");
  lines.push("");
  lines.push(costLine(summary.cases, summary.mode));
  lines.push(`- record_type: ${pct(agg.recordTypeAccuracy)}`);
  lines.push(`- record_date: ${pct(agg.recordDateAccuracy)}`);
  lines.push("");
  lines.push(
    ...table(
      ["set", "tp", "fp", "fn", "precision", "recall", "f1"],
      [
        prRow("observations", agg.observations),
        prRow("findings", agg.findings),
        prRow("conditions", agg.conditions),
        prRow("findings_to_resolve", agg.findingsToResolve),
        prRow("conditions_to_resolve", agg.conditionsToResolve),
        prRow("checkups_to_complete", agg.checkupsToComplete),
      ],
    ),
  );
  lines.push("");

  lines.push(...fieldSection("Observation fields", "observation", agg.observationFields));
  lines.push(...fieldSection("Finding fields", "finding", agg.findingFields));
  lines.push(...fieldSection("Condition fields", "condition", agg.conditionFields));
  // Printed beside the set score rather than folded into it: the set says the right condition was
  // named, this says it was named on evidence the production gate accepts. A run can be perfect on
  // the first and apply nothing.
  lines.push(
    ...fieldSection(
      "Condition resolution fields",
      "condition resolution",
      agg.conditionResolutionFields,
    ),
  );

  lines.push("## Cases");
  lines.push("");
  for (const result of summary.cases) {
    lines.push(`### ${result.caseId}`);
    lines.push("");
    if (result.error) {
      lines.push(`**Failed:** ${result.error}`);
      lines.push("");
      continue;
    }
    const score = result.score;
    if (!score) continue;
    lines.push(
      `- record_type ${score.recordType.correct ? "ok" : `**expected \`${score.recordType.expected}\`, got \`${score.recordType.actual}\`**`}`,
    );
    lines.push(
      `- record_date ${score.recordDate.correct ? "ok" : `**expected \`${score.recordDate.expected}\`, got \`${score.recordDate.actual}\`**`}`,
    );
    lines.push("");
    lines.push(
      ...table(
        ["set", "tp", "fp", "fn", "precision", "recall", "f1"],
        [
          prRow("observations", score.observations),
          prRow("findings", score.findings),
          prRow("conditions", score.conditions),
          prRow("findings_to_resolve", score.findingsToResolve),
          prRow("conditions_to_resolve", score.conditionsToResolve),
          prRow("checkups_to_complete", score.checkupsToComplete),
        ],
      ),
    );
    lines.push("");
    // Every scored set gets its misses printed, not just observations. A findings row reading
    // 0 tp / 3 fp / 2 fn is unreadable on its own — the labels are what tell you whether the
    // pipeline found the wrong things or found the right things and named them differently.
    for (const [label, set] of [
      ["observations", score.observations],
      ["findings", score.findings],
      ["conditions", score.conditions],
      ["finding resolutions", score.findingsToResolve],
      ["condition resolutions", score.conditionsToResolve],
      ["checkup completions", score.checkupsToComplete],
    ] as const) {
      if (set.falseNegatives.length > 0) {
        lines.push(`- missed ${label}: ${set.falseNegatives.join(", ")}`);
      }
      if (set.falsePositives.length > 0) {
        lines.push(`- invented ${label}: ${set.falsePositives.join(", ")}`);
      }
    }
    // Findings are keyed on site+laterality, so two on the same organ and side are
    // indistinguishable. Say so rather than let the pairing look authoritative.
    if (score.findingKeyCollisions.length > 0) {
      lines.push(
        `- **ambiguous finding pairing**: ${score.findingKeyCollisions.join(", ")} — more than ` +
          `one finding shares this site and laterality, so field comparisons on it are unreliable`,
      );
    }
    if (result.diagnostics) {
      const d = result.diagnostics;
      lines.push(
        `- diagnostics: stages ${d.stagesRun.join("+") || "none"}, dropped ${d.droppedInvalidCount}, unresolved ${d.unresolvedCatalogCount}, rejected ${d.rejected.length}, tokens ${d.promptTokens ?? "?"}/${d.completionTokens ?? "?"}, cost ${formatCost(d.costUsd)}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function renderJson(summary: RunSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}
