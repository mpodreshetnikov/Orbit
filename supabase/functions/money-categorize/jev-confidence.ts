/**
 * Calibrated on the 2026-11-10 labeled sample after M2 (eligible_categories in Noul state).
 * Prior 0.65/0.25 assumed Noul~0.2–0.4 without the category list; with the list Noul rises
 * (p50≈0.70) and 0.65/0.5 restores 100% precision on applied rows at ~61% coverage.
 */
export const DEFAULT_JEV_PROBABILITY_THRESHOLD = 0.65;
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
