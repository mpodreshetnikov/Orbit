import { describe, expect, it } from "vitest";
import {
  MIN_BRANCHES_PCT,
  MIN_LINES_PCT,
  evaluateSrcCoverage,
  formatPct,
  isSrcEntry,
  pct,
} from "./src-coverage-threshold.cjs";

function srcSummary(
  lines: { covered: number; total: number },
  branches: { covered: number; total: number },
) {
  return {
    total: { lines: { covered: 0, total: 1000 }, branches: { covered: 0, total: 1000 } },
    "src/lib/example.ts": { lines, branches },
  };
}

describe("src-coverage-threshold", () => {
  it("enforces an 80% floor on lines and branches", () => {
    expect(MIN_LINES_PCT).toBe(80);
    expect(MIN_BRANCHES_PCT).toBe(80);
  });

  it("formats percentages to two decimals", () => {
    expect(formatPct(80)).toBe("80.00");
    expect(formatPct(79.9999)).toBe("80.00");
  });

  it("accepts src/** entries and ignores non-src keys", () => {
    expect(isSrcEntry("src/lib/a.ts")).toBe(true);
    expect(isSrcEntry("scripts/just/x.cjs")).toBe(false);
  });

  it("treats zero totals as 100%", () => {
    expect(pct(0, 0)).toBe(100);
    expect(pct(1, 2)).toBe(50);
  });

  it("ignores the total rollup when scoring src/**", () => {
    const result = evaluateSrcCoverage(
      srcSummary({ covered: 80, total: 100 }, { covered: 80, total: 100 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.linesCovered).toBe(80);
      expect(result.linesTotal).toBe(100);
    }
  });

  it("passes when src aggregates meet the floor", () => {
    const result = evaluateSrcCoverage(
      srcSummary({ covered: 80, total: 100 }, { covered: 80, total: 100 }),
    );
    expect(result.ok).toBe(true);
  });

  it("passes when float noise sits just under the floor within epsilon", () => {
    // 799999/1000000 = 79.9999; +0.0001 epsilon still clears the < 80 check.
    expect(
      evaluateSrcCoverage(
        srcSummary({ covered: 799999, total: 1_000_000 }, { covered: 80, total: 100 }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateSrcCoverage(
        srcSummary({ covered: 80, total: 100 }, { covered: 799999, total: 1_000_000 }),
      ).ok,
    ).toBe(true);
  });

  it("fails when lines are under 80%", () => {
    const result = evaluateSrcCoverage(
      srcSummary({ covered: 79, total: 100 }, { covered: 80, total: 100 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("lines threshold failed");
  });

  it("fails when branches are under 80%", () => {
    const result = evaluateSrcCoverage(
      srcSummary({ covered: 80, total: 100 }, { covered: 79, total: 100 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("branches threshold failed");
  });

  it("fails when no src entries exist", () => {
    const result = evaluateSrcCoverage({
      total: {},
      "scripts/x.cjs": { lines: { covered: 1, total: 1 }, branches: { covered: 1, total: 1 } },
    });
    expect(result.ok).toBe(false);
  });

  it("tolerates missing metric objects without throwing", () => {
    expect(() => evaluateSrcCoverage({ "src/a.ts": null })).not.toThrow();
    expect(() => evaluateSrcCoverage({ "src/a.ts": {} })).not.toThrow();
    expect(() =>
      evaluateSrcCoverage({ "src/a.ts": { lines: null, branches: null } }),
    ).not.toThrow();
    const result = evaluateSrcCoverage({ "src/a.ts": null });
    // zero totals → 100% via pct()
    expect(result.ok).toBe(true);
  });
});
