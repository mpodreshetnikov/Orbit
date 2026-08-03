import { describe, it, expect } from "vitest";
import { describeMeasurement } from "./describe";

// Mirrors the house test style: translations resolve to their raw key.
const t = (key: string) => key;

describe("describeMeasurement", () => {
  it("speaks name, value, unit and direction", () => {
    expect(
      describeMeasurement({ name: "Left bicep", value: 38.5, unit: "cm", trend: "up", t }),
    ).toBe("Left bicep, 38.5 cm, measurements.a11y.rising");
  });

  it("distinguishes the three directions", () => {
    const base = { name: "Chest", value: 100, unit: "cm", t };
    expect(describeMeasurement({ ...base, trend: "up" })).toContain("measurements.a11y.rising");
    expect(describeMeasurement({ ...base, trend: "down" })).toContain("measurements.a11y.falling");
    expect(describeMeasurement({ ...base, trend: "flat" })).toContain(
      "measurements.a11y.unchanged",
    );
  });

  it("announces the add action when there is no value", () => {
    expect(describeMeasurement({ name: "Waist", value: null, unit: "cm", trend: null, t })).toBe(
      "Waist, measurements.a11y.noValueAdd",
    );
  });

  it("does not mention a trend when there is nothing to compare", () => {
    expect(describeMeasurement({ name: "Hips", value: 95, unit: "cm", trend: null, t })).toBe(
      "Hips, 95 cm",
    );
  });

  it("drops the decimal on whole values, matching the visible chip", () => {
    expect(describeMeasurement({ name: "Neck", value: 40, unit: "cm", trend: null, t })).toBe(
      "Neck, 40 cm",
    );
    expect(describeMeasurement({ name: "Neck", value: 40.25, unit: "cm", trend: null, t })).toBe(
      "Neck, 40.3 cm",
    );
  });

  it("omits the unit when the catalog has none", () => {
    expect(describeMeasurement({ name: "BMI", value: 22.4, unit: "", trend: null, t })).toBe(
      "BMI, 22.4",
    );
  });
});
