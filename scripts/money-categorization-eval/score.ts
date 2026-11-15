/**
 * Scoring for the money categorization eval corpus.
 *
 * Pure by design — plain data in, plain data out. Everything that touches the world lives in
 * run.ts, so this module can be unit-tested directly.
 */
import type { CaseExpected, CasePrediction } from "./types.ts";

export const SCORED_FIELDS = ["category_id", "canonical_system_key"] as const;

export interface FieldMismatch {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface CaseScore {
  caseId: string;
  /** True when category_id matches (including both-null abstention). */
  correct: boolean;
  expectedCategoryId: string | null;
  actualCategoryId: string | null;
  expectedSystemKey: string | null;
  actualSystemKey: string | null;
  fieldMismatches: FieldMismatch[];
}

export interface ConfusionCell {
  expected: string;
  actual: string;
  count: number;
}

export interface Aggregate {
  scored: number;
  correct: number;
  accuracy: number;
  /** Per expected system key: how often the prediction matched. */
  perKey: Record<string, { expected: number; correct: number; accuracy: number }>;
  confusion: ConfusionCell[];
  fieldMismatches: number;
}

function label(value: string | null): string {
  return value === null ? "<null>" : value;
}

export function scoreCase(
  caseId: string,
  expected: CaseExpected,
  actual: CasePrediction,
): CaseScore {
  const fieldMismatches: FieldMismatch[] = [];
  if (expected.category_id !== actual.category_id) {
    fieldMismatches.push({
      field: "category_id",
      expected: expected.category_id,
      actual: actual.category_id,
    });
  }
  if (expected.canonical_system_key !== actual.canonical_system_key) {
    fieldMismatches.push({
      field: "canonical_system_key",
      expected: expected.canonical_system_key,
      actual: actual.canonical_system_key,
    });
  }
  return {
    caseId,
    correct: expected.category_id === actual.category_id,
    expectedCategoryId: expected.category_id,
    actualCategoryId: actual.category_id,
    expectedSystemKey: expected.canonical_system_key,
    actualSystemKey: actual.canonical_system_key,
    fieldMismatches,
  };
}

export function aggregate(scores: CaseScore[]): Aggregate {
  const perKeyRaw = new Map<string, { expected: number; correct: number }>();
  const confusionMap = new Map<string, ConfusionCell>();
  let correct = 0;
  let fieldMismatches = 0;

  for (const score of scores) {
    if (score.correct) correct += 1;
    fieldMismatches += score.fieldMismatches.length;

    const key = label(score.expectedSystemKey);
    const bucket = perKeyRaw.get(key) ?? { expected: 0, correct: 0 };
    bucket.expected += 1;
    if (score.correct) bucket.correct += 1;
    perKeyRaw.set(key, bucket);

    const confKey = `${label(score.expectedSystemKey)}→${label(score.actualSystemKey)}`;
    const cell = confusionMap.get(confKey) ?? {
      expected: label(score.expectedSystemKey),
      actual: label(score.actualSystemKey),
      count: 0,
    };
    cell.count += 1;
    confusionMap.set(confKey, cell);
  }

  const perKey: Aggregate["perKey"] = {};
  for (const [key, value] of perKeyRaw) {
    perKey[key] = {
      ...value,
      accuracy: value.expected === 0 ? 0 : value.correct / value.expected,
    };
  }

  return {
    scored: scores.length,
    correct,
    accuracy: scores.length === 0 ? 0 : correct / scores.length,
    perKey,
    confusion: [...confusionMap.values()].sort((a, b) => b.count - a.count),
    fieldMismatches,
  };
}
