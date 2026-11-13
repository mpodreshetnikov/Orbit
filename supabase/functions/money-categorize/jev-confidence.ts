/**
 * Maxim confirmed probability floor 0.9 (2026-11-13). Noul companion still gates fit after
 * eligible_categories were added to state; keep noul ≥ 0.5 from the M2 recalibration.
 */
export const DEFAULT_JEV_PROBABILITY_THRESHOLD = 0.9;
export const DEFAULT_JEV_NOUL_THRESHOLD = 0.5;

export interface JevConfidenceInput {
  choice: string | null;
  /** `probabilities[choice]` from TypeSafe Choice. */
  choiceProbability: number | null;
  /** Companion Noul `any_fit` score. */
  noul: number | null;
  probabilityThreshold?: number;
  noulThreshold?: number;
}

export interface JevConfidenceDecision {
  apply: boolean;
  reason: string;
  choiceProbability: number | null;
  noul: number | null;
  probabilityThreshold: number;
  noulThreshold: number;
}

export function decideJevCategoryApplication(input: JevConfidenceInput): JevConfidenceDecision {
  const probabilityThreshold = input.probabilityThreshold ?? DEFAULT_JEV_PROBABILITY_THRESHOLD;
  const noulThreshold = input.noulThreshold ?? DEFAULT_JEV_NOUL_THRESHOLD;
  const choiceProbability =
    typeof input.choiceProbability === "number" && Number.isFinite(input.choiceProbability)
      ? input.choiceProbability
      : null;
  const noul = typeof input.noul === "number" && Number.isFinite(input.noul) ? input.noul : null;

  if (!input.choice) {
    return {
      apply: false,
      reason: "Jev returned no category choice",
      choiceProbability,
      noul,
      probabilityThreshold,
      noulThreshold,
    };
  }

  if (choiceProbability == null || choiceProbability < probabilityThreshold) {
    return {
      apply: false,
      reason: `Jev choice probability below threshold (${choiceProbability ?? "null"} < ${probabilityThreshold})`,
      choiceProbability,
      noul,
      probabilityThreshold,
      noulThreshold,
    };
  }

  if (noul == null || noul < noulThreshold) {
    return {
      apply: false,
      reason: `Jev any_fit (Noul) below threshold (${noul ?? "null"} < ${noulThreshold})`,
      choiceProbability,
      noul,
      probabilityThreshold,
      noulThreshold,
    };
  }

  return {
    apply: true,
    reason: `Jev selected category with probability ${choiceProbability.toFixed(3)} and Noul ${noul.toFixed(3)}`,
    choiceProbability,
    noul,
    probabilityThreshold,
    noulThreshold,
  };
}
