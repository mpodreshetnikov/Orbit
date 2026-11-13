"use strict";

/**
 * Aggregate Stryker mutant statuses into Orbit summary scores.
 * Invalid (RuntimeError/CompileError) and Ignored stay diagnostic-only —
 * excluded from both mutation-score denominators (Stryker metrics).
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

module.exports = { summarizeMutantStatuses };
