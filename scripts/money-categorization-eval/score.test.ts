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
  });

  it("treats both-null abstention as correct", () => {
    const score = scoreCase(
      "009",
      expected({ category_id: null, canonical_system_key: null }),
      prediction({ category_id: null, canonical_system_key: null }),
    );
    expect(score.correct).toBe(true);
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
    expect(score.fieldMismatches.map((row) => row.field).sort()).toEqual([
      "canonical_system_key",
      "category_id",
    ]);
  });
});

describe("aggregate", () => {
  it("reports accuracy and per-key buckets", () => {
    const summary = aggregate([
      scoreCase("a", expected(), prediction()),
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
    ]);
    expect(summary.scored).toBe(2);
    expect(summary.correct).toBe(1);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.perKey.food.accuracy).toBe(1);
    expect(summary.perKey.transport.accuracy).toBe(0);
  });
});
