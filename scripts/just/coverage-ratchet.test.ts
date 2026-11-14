import { describe, expect, it } from "vitest";
import { MINIMUM_TARGETS, evaluateRatchet, getByPath } from "./coverage-ratchet.cjs";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    vitest: { lines_pct: 80, branches_pct: 80 },
    deno: { lines_pct: 75, branches_pct: 75 },
    surfaces: {
      web: { instrumented_ratio_pct: 90 },
      supabase_functions: { instrumented_ratio_pct: 90 },
    },
    db: { totals: { function_mapping_ratio_pct: 75, policy_mapping_ratio_pct: 75 } },
    ...overrides,
  };
}

describe("coverage-ratchet", () => {
  it("requires vitest lines at 80%", () => {
    expect(MINIMUM_TARGETS["vitest.lines_pct"]).toBe(80);
    expect(MINIMUM_TARGETS["deno.lines_pct"]).toBe(75);
  });

  it("reads nested metric paths", () => {
    expect(getByPath({ a: { b: 3 } }, "a.b")).toBe(3);
    expect(getByPath({}, "a.b")).toBeUndefined();
  });

  it("passes when all minimum targets are met", () => {
    expect(evaluateRatchet(summary())).toEqual([]);
  });

  it("treats missing metrics as zero against targets", () => {
    const failures = evaluateRatchet({});
    expect(failures.some((f) => f.includes("vitest.lines_pct") && f.includes("target"))).toBe(true);
  });

  it("fails when vitest lines fall below 80%", () => {
    const failures = evaluateRatchet(summary({ vitest: { lines_pct: 79.9, branches_pct: 80 } }));
    expect(failures.some((f) => f.includes("vitest.lines_pct") && f.includes("79.9"))).toBe(true);
  });

  it("passes when float noise sits just under a target within epsilon", () => {
    expect(evaluateRatchet(summary({ vitest: { lines_pct: 79.9999, branches_pct: 80 } }))).toEqual(
      [],
    );
  });

  it("reports non-numeric metric values", () => {
    const failures = evaluateRatchet(summary({ vitest: { lines_pct: "nope", branches_pct: 80 } }));
    expect(failures.some((f) => f.includes("not numeric"))).toBe(true);
  });

  it("enforces baseline when requested", () => {
    const failures = evaluateRatchet(summary(), {
      enforceBaseline: true,
      baseline: { metrics: { "vitest.lines_pct": 90 } },
    });
    expect(failures.some((f) => f.includes("baseline 90"))).toBe(true);
  });

  it("passes baseline enforce when current meets baseline and targets", () => {
    expect(
      evaluateRatchet(summary(), {
        enforceBaseline: true,
        baseline: { metrics: { "vitest.lines_pct": 80 } },
      }),
    ).toEqual([]);
  });

  it("passes baseline float epsilon just under baseline", () => {
    expect(
      evaluateRatchet(summary({ vitest: { lines_pct: 89.9999, branches_pct: 80 } }), {
        enforceBaseline: true,
        baseline: { metrics: { "vitest.lines_pct": 90 } },
      }),
    ).toEqual([]);
  });

  it("reports non-numeric values under baseline enforce", () => {
    const failures = evaluateRatchet(summary({ vitest: { lines_pct: "x", branches_pct: 80 } }), {
      enforceBaseline: true,
      baseline: { metrics: { "vitest.lines_pct": 80 } },
    });
    expect(failures.some((f) => f.includes("not numeric"))).toBe(true);
  });

  it("reports non-numeric baseline-only metrics (not in MINIMUM_TARGETS)", () => {
    const failures = evaluateRatchet(summary({ vitest: { lines_pct: 80, branches_pct: "x" } }), {
      enforceBaseline: true,
      baseline: { metrics: { "vitest.branches_pct": 80 } },
    });
    expect(failures).toEqual(["vitest.branches_pct: current value is not numeric"]);
  });

  it("reports missing baseline under enforce mode", () => {
    expect(evaluateRatchet(summary(), { enforceBaseline: true })).toEqual([
      "missing baseline; run coverage-ratchet --update-baseline",
    ]);
  });
});
