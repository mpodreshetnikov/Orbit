/** Rendering only — pure, so the shape of a report can be asserted without running an eval. */
import type { Aggregate, CaseScore } from "./score.ts";
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

function table(headers: string[], rows: string[]): string[] {
  return [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows];
}

export function renderMarkdown(summary: RunSummary): string {
  const lines: string[] = [
    `# Money categorization eval`,
    "",
    `- Model: \`${summary.model}\``,
    `- Mode: \`${summary.mode}\``,
    `- Generated: ${summary.generatedAt}`,
    `- Cases scored: ${summary.aggregate.scored}`,
    `- Accuracy: **${pct(summary.aggregate.accuracy)}** (${summary.aggregate.correct}/${summary.aggregate.scored})`,
    "",
    `## Per expected system key`,
    "",
  ];

  const perKeyRows = Object.entries(summary.aggregate.perKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) => `| ${key} | ${value.correct}/${value.expected} | ${pct(value.accuracy)} |`,
    );
  lines.push(...table(["expected key", "correct", "accuracy"], perKeyRows), "");

  if (summary.aggregate.confusion.length > 0) {
    lines.push(`## Confusion`, "");
    lines.push(
      ...table(
        ["expected", "actual", "count"],
        summary.aggregate.confusion.map(
          (cell) => `| ${cell.expected} | ${cell.actual} | ${cell.count} |`,
        ),
      ),
      "",
    );
  }

  lines.push(`## Cases`, "");
  for (const result of summary.cases) {
    if (result.error) {
      lines.push(`### ${result.caseId}`, "", `FAILED: ${result.error}`, "");
      continue;
    }
    const score = result.score!;
    const mark = score.correct ? "correct" : "wrong";
    lines.push(
      `### ${result.caseId} — ${mark}`,
      "",
      `- expected: \`${score.expectedSystemKey ?? "null"}\` (${score.expectedCategoryId ?? "null"})`,
      `- actual: \`${score.actualSystemKey ?? "null"}\` (${score.actualCategoryId ?? "null"})`,
    );
    if (score.fieldMismatches.length > 0) {
      for (const mismatch of score.fieldMismatches) {
        lines.push(
          `- mismatch \`${mismatch.field}\`: expected \`${String(mismatch.expected)}\`, actual \`${String(mismatch.actual)}\``,
        );
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderJson(summary: RunSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}
