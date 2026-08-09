/** Rendering only — pure, so the shape of a report can be asserted without running an eval. */
import type { Aggregate, CaseScore, FieldAccuracy, SetScore } from "./score.ts";
import type { CaseDiagnostics } from "./types.ts";

export interface CaseResult {
  caseId: string;
  score?: CaseScore;
  diagnostics?: CaseDiagnostics;
  error?: string;
}

export interface RunSummary {
  model: string;
  mode: string;
  generatedAt: string;
  cases: CaseResult[];
  aggregate: Aggregate;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
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

  lines.push("## Aggregate");
  lines.push("");
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
        `- diagnostics: stages ${d.stagesRun.join("+") || "none"}, dropped ${d.droppedInvalidCount}, unresolved ${d.unresolvedCatalogCount}, rejected ${d.rejected.length}, tokens ${d.promptTokens ?? "?"}/${d.completionTokens ?? "?"}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function renderJson(summary: RunSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}
