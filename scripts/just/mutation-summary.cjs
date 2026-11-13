"use strict";

/**
 * Aggregate Stryker mutant statuses into Orbit summary scores.
 *
 * Stryker formulas (v8/v9 Mutation Testing Elements):
 *   mutationScore         = (killed + timeout) / (killed + survived + noCoverage + timeout)
 *   mutationScoreCovered  = (killed + timeout) / (killed + survived + timeout)
 *
 * Invalid (RuntimeError/CompileError) and Ignored are diagnostic-only — out of both
 * denominators. Stryker's own `thresholds.break` uses overall mutationScore (incl.
 * NoCoverage); Orbit's required gate is mutationScoreCovered === 100 (no survivors).
 */
function summarizeMutantStatuses(files) {
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let timeout = 0;
  let runtimeErrors = 0;
  let ignored = 0;
  for (const file of Object.values(files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      switch (mutant.status) {
        case "Killed":
          killed += 1;
          break;
        case "Survived":
          survived += 1;
          break;
        case "NoCoverage":
          noCoverage += 1;
          break;
        case "Timeout":
          timeout += 1;
          break;
        case "RuntimeError":
        case "CompileError":
          runtimeErrors += 1;
          break;
        case "Ignored":
          ignored += 1;
          break;
        // Stryker disable next-line all: empty default is equivalent to omitting default
        default:
          break;
      }
    }
  }
  const totalMutants = killed + survived + noCoverage + timeout;
  const detected = killed + timeout;
  const mutationScore =
    totalMutants > 0 ? Math.round((10000 * detected) / totalMutants) / 100 : null;
  const covered = killed + survived + timeout;
  const mutationScoreCovered = covered > 0 ? Math.round((10000 * detected) / covered) / 100 : null;
  return {
    mutationScore,
    mutationScoreCovered,
    killed,
    survived,
    noCoverage,
    timeout,
    runtimeErrors,
    ignored,
    totalMutants,
  };
}

/**
 * Required Quality Gates check: covered mutation score must be 100% (no survivors).
 * NoCoverage is allowed (line-coverage floors own that). Empty / skip → pass.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function evaluateCoveredMutationGate(summary) {
  if (summary == null) {
    return { ok: true };
  }
  if (summary.mode === "incremental-skip") {
    return { ok: true };
  }
  const survived = Number(summary.survived ?? 0);
  const covered = summary.mutationScoreCovered;
  if (survived > 0) {
    return {
      ok: false,
      reason: `mutationScoreCovered gate failed: ${survived} survived mutant(s) on covered lines (scoreCovered=${covered})`,
    };
  }
  if (covered == null) {
    return { ok: true };
  }
  if (covered < 100) {
    return {
      ok: false,
      reason: `mutationScoreCovered gate failed: ${covered} < 100`,
    };
  }
  return { ok: true };
}

/**
 * Read reports/mutation/mutation.json and evaluate the covered gate.
 * @param {string} reportPath
 * @param {{ existsSync: (p: string) => boolean, readFileSync: (p: string, enc: string) => string }} [fsModule]
 * @returns {{ ok: boolean, reason?: string, summary?: ReturnType<typeof summarizeMutantStatuses> }}
 */
function evaluateCoveredMutationGateFromReport(reportPath, fsModule = require("node:fs")) {
  if (!fsModule.existsSync(reportPath)) {
    return { ok: false, reason: `missing Stryker report at ${reportPath}` };
  }
  const report = JSON.parse(fsModule.readFileSync(reportPath, "utf8"));
  const summary = summarizeMutantStatuses(report.files ?? {});
  return { ...evaluateCoveredMutationGate({ ...summary, mode: "incremental" }), summary };
}

module.exports = {
  summarizeMutantStatuses,
  evaluateCoveredMutationGate,
  evaluateCoveredMutationGateFromReport,
};
