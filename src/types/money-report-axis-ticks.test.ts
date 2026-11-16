import { describe, expect, it } from "vitest";
import { niceAxisTicks } from "@/types/money-report-axis-ticks";

describe("niceAxisTicks", () => {
  it("returns [0] for non-positive or non-finite maxima", () => {
    expect(niceAxisTicks(0)).toEqual([0]);
    expect(niceAxisTicks(-5)).toEqual([0]);
    expect(niceAxisTicks(Number.NaN)).toEqual([0]);
    expect(niceAxisTicks(Number.POSITIVE_INFINITY)).toEqual([0]);
  });

  it("builds round Y-axis ticks covering the max across 1/2/5×10ⁿ bands", () => {
    expect(niceAxisTicks(8, 4)).toEqual([0, 2, 4, 6, 8]);
    expect(niceAxisTicks(40, 4)).toEqual([0, 10, 20, 30, 40]);
    expect(niceAxisTicks(50, 4)).toEqual([0, 20, 40, 60]);
    expect(niceAxisTicks(87)).toEqual([0, 50, 100]);
    expect(niceAxisTicks(100, 4)).toEqual([0, 50, 100]);
    // normalized === 5 must use 5×10ⁿ (kills < vs <= on the ≤5 band).
    expect(niceAxisTicks(200, 4)).toEqual([0, 50, 100, 150, 200]);
    expect(niceAxisTicks(120, 5)).toEqual([0, 50, 100, 150]);
    expect(niceAxisTicks(250, 4)).toEqual([0, 100, 200, 300]);
    // normalized === 1 band (≤1 uses power).
    expect(niceAxisTicks(4, 4)).toEqual([0, 1, 2, 3, 4]);
    // normalized just above 2 uses 5× band.
    expect(niceAxisTicks(9, 4)).toEqual([0, 5, 10]);
    expect(niceAxisTicks(1000)[niceAxisTicks(1000).length - 1]).toBeGreaterThanOrEqual(1000);
    expect(niceAxisTicks(3)[niceAxisTicks(3).length - 1]).toBeGreaterThanOrEqual(3);
    expect(niceAxisTicks(15)[niceAxisTicks(15).length - 1]).toBeGreaterThanOrEqual(15);
  });

  it("clamps a zero or negative target to at least one tick step", () => {
    expect(niceAxisTicks(10, 0)).toEqual([0, 10]);
    expect(niceAxisTicks(10, -3)).toEqual([0, 10]);
  });
});
