import { describe, expect, it } from "vitest";
import {
  COMPARISON_BASE_EPSILON,
  COMPARISON_MAX_RATIO,
  formatChange,
  percentChange,
} from "./money-report-change";

describe("percentChange", () => {
  it("returns a whole percent when the base is meaningful", () => {
    expect(percentChange(118420, 109650)).toBe(8);
    expect(percentChange(-20, -10)).toBe(-100);
    expect(percentChange(130059, 30400)).toBe(328);
    expect(percentChange(1000, 100)).toBe(900);
  });

  it("returns null for tiny, zero, exact-epsilon, or non-finite bases", () => {
    expect(percentChange(50, 0)).toBeNull();
    expect(percentChange(12736, 1)).toBeNull();
    expect(percentChange(12736, 0.5)).toBeNull();
    // Exact epsilon with a modest ratio must stay null (kills < vs <= on the epsilon check).
    expect(percentChange(5, COMPARISON_BASE_EPSILON)).toBeNull();
    expect(percentChange(2.02, COMPARISON_BASE_EPSILON + 0.01)).toBe(100);
    expect(percentChange(10, Number.NaN)).toBeNull();
    expect(percentChange(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns null for non-finite values", () => {
    expect(percentChange(Number.NaN, 100)).toBeNull();
    expect(percentChange(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });

  it("returns null when growth exceeds the max ratio", () => {
    expect(percentChange(130059, 1534)).toBeNull();
    expect(percentChange(1001, 100)).toBeNull();
    expect(Math.abs(1001) / Math.abs(100)).toBeGreaterThan(COMPARISON_MAX_RATIO);
  });
});

describe("formatChange", () => {
  it("formats percent arrows and zero", () => {
    expect(formatChange(8)).toBe("▲ 8%");
    expect(formatChange(-3)).toBe("▼ 3%");
    expect(formatChange(0)).toBe("0%");
  });

  it("shows ×N when percent is null but growth is over the max ratio", () => {
    expect(formatChange(null, { value: 130059, base: 1534 })).toBe("×85");
    expect(formatChange(null, { value: 29450, base: 1234 })).toBe("×24");
    expect(formatChange(null, { value: 1001, base: 100 })).toBe("×10");
    // Exactly 10× stays a percent path from percentChange; formatChange without percent shows new.
    expect(percentChange(1000, 100)).toBe(900);
    expect(formatChange(900, { value: 1000, base: 100 })).toBe("▲ 900%");
    expect(formatChange(null, { value: 1000, base: 100 })).toBe("новое");
  });

  it("shows the new label when there is a positive value without a usable base", () => {
    expect(formatChange(null, { value: 500 })).toBe("новое");
    expect(formatChange(null, { value: 500, newLabel: "new" })).toBe("new");
    expect(formatChange(null, { value: 130059, base: 0 })).toBe("новое");
    expect(formatChange(null, { value: 130059, base: 1, newLabel: "new" })).toBe("new");
  });

  it("returns null without options, without a value, or without a positive current value", () => {
    expect(formatChange(null)).toBeNull();
    expect(formatChange(null, {})).toBeNull();
    expect(formatChange(null, { base: 100 })).toBeNull();
    expect(formatChange(null, { value: 0 })).toBeNull();
    expect(formatChange(null, { value: COMPARISON_BASE_EPSILON * 0.005 })).toBeNull();
    expect(formatChange(null, { value: Number.NaN, base: 100 })).toBeNull();
    // Non-finite base skips ×N; a positive value still reads as new.
    expect(formatChange(null, { value: 100, base: Number.NaN })).toBe("новое");
  });

  it("keeps a normal percent label when options are present but change is known", () => {
    expect(formatChange(328, { value: 130059, base: 30400 })).toBe("▲ 328%");
  });

  it("does not treat modest growth as ×N (ratio uses division, and > not >=)", () => {
    // product 5*3=15 > 10 would wrongly enter ×N if * replaced /; ratio 1.67 must stay "новое"
    expect(formatChange(null, { value: 5, base: 3 })).toBe("новое");
    // exactly 10× must not become ×10 when the check is strict >
    expect(formatChange(null, { value: 1000, base: 100 })).toBe("новое");
    expect(formatChange(null, { value: 1001, base: 100 })).toBe("×10");
  });
});
