import { describe, expect, it } from "vitest";
import { aggregate, scoreCase } from "./score";
import type { CaseExpected, CasePrediction } from "./types";

function expected(overrides: Partial<CaseExpected> = {}): CaseExpected {
  return {
    category_id: "44000001-0000-4000-8000-000000000005",
    canonical_system_key: "food",
    ...overrides,
  };
}

function prediction(overrides: Partial<CasePrediction> = {}): CasePrediction {
  return {
    category_id: "44000001-0000-4000-8000-000000000005",
    canonical_system_key: "food",
    reason: "ok",
    ...overrides,
  };
}

describe("scoreCase", () => {
  it("marks an exact category match correct", () => {
    const score = scoreCase("001", expected(), prediction());
    expect(score.correct).toBe(true);
    expect(score.fieldMismatches).toEqual([]);
    expect(score.caseId).toBe("001");
    expect(score.expectedCategoryId).toBe(expected().category_id);
    expect(score.actualCategoryId).toBe(prediction().category_id);
  });

  it("treats both-null abstention as correct", () => {
    const score = scoreCase(
      "009",
      expected({ category_id: null, canonical_system_key: null }),
      prediction({ category_id: null, canonical_system_key: null }),
    );
    expect(score.correct).toBe(true);
    expect(score.expectedSystemKey).toBeNull();
    expect(score.actualSystemKey).toBeNull();
  });

  it("records field mismatches when the category is wrong", () => {
    const score = scoreCase(
      "003",
      expected({
        category_id: "44000001-0000-4000-8000-000000000004",
        canonical_system_key: "utilities",
      }),
      prediction({
        category_id: "44000001-0000-4000-8000-00000000000e",
        canonical_system_key: "services_fees",
      }),
    );
    expect(score.correct).toBe(false);
    expect(score.fieldMismatches).toEqual([
      {
        field: "category_id",
        expected: "44000001-0000-4000-8000-000000000004",
        actual: "44000001-0000-4000-8000-00000000000e",
      },
      {
        field: "canonical_system_key",
        expected: "utilities",
        actual: "services_fees",
      },
    ]);
  });

  it("counts a system-key-only mismatch even when category_id matches", () => {
    const score = scoreCase(
      "x",
      expected(),
      prediction({ canonical_system_key: "shopping" }),
    );
    expect(score.correct).toBe(true);
    expect(score.fieldMismatches).toEqual([
      {
        field: "canonical_system_key",
        expected: "food",
        actual: "shopping",
      },
    ]);
  });
});

describe("aggregate", () => {
  it("reports zero accuracy on an empty run", () => {
    expect(aggregate([])).toEqual({
      scored: 0,
      correct: 0,
      accuracy: 0,
      perKey: {},
      confusion: [],
      fieldMismatches: 0,
    });
  });

  it("reports accuracy, per-key buckets, mismatch totals and sorted confusion", () => {
    // Insert low-count cells first so Map iteration order differs from count-desc sort order.
    const summary = aggregate([
      scoreCase(
        "c",
        expected({ category_id: null, canonical_system_key: null }),
        prediction({ category_id: null, canonical_system_key: null }),
      ),
      scoreCase(
        "b",
        expected({
          category_id: "44000001-0000-4000-8000-000000000006",
          canonical_system_key: "transport",
        }),
        prediction({
          category_id: "44000001-0000-4000-8000-000000000007",
          canonical_system_key: "shopping",
        }),
      ),
      scoreCase("a", expected(), prediction()),
      scoreCase("a2", expected(), prediction()),
    ]);

    expect(summary.scored).toBe(4);
    expect(summary.correct).toBe(3);
    expect(summary.accuracy).toBe(0.75);
    expect(summary.fieldMismatches).toBe(2);
    expect(summary.perKey.food).toEqual({ expected: 2, correct: 2, accuracy: 1 });
    expect(summary.perKey.transport).toEqual({ expected: 1, correct: 0, accuracy: 0 });
    expect(summary.perKey["<null>"]).toEqual({ expected: 1, correct: 1, accuracy: 1 });
    expect(summary.confusion).toEqual([
      { expected: "food", actual: "food", count: 2 },
      { expected: "<null>", actual: "<null>", count: 1 },
      { expected: "transport", actual: "shopping", count: 1 },
    ]);
  });
});
