import { describe, it, expect } from "vitest";
import { getMeasurementTrend } from "./measurement-trend";

describe("getMeasurementTrend", () => {
  it("returns null without something to compare against", () => {
    expect(getMeasurementTrend([])).toBeNull();
    expect(getMeasurementTrend([{ value: 100 }])).toBeNull();
  });

  it("reads the last two points, oldest first", () => {
    expect(getMeasurementTrend([{ value: 200 }, { value: 100 }, { value: 110 }])).toBe("up");
  });

  it("reports a rise and a fall", () => {
    expect(getMeasurementTrend([{ value: 100 }, { value: 105 }])).toBe("up");
    expect(getMeasurementTrend([{ value: 100 }, { value: 95 }])).toBe("down");
  });

  it("treats a change under 1% as flat", () => {
    expect(getMeasurementTrend([{ value: 100 }, { value: 100.5 }])).toBe("flat");
    expect(getMeasurementTrend([{ value: 100 }, { value: 99.5 }])).toBe("flat");
    expect(getMeasurementTrend([{ value: 100 }, { value: 100 }])).toBe("flat");
  });

  it("treats exactly 1% as a change", () => {
    expect(getMeasurementTrend([{ value: 100 }, { value: 101 }])).toBe("up");
    expect(getMeasurementTrend([{ value: 100 }, { value: 99 }])).toBe("down");
  });

  it("returns null when the previous value is zero", () => {
    expect(getMeasurementTrend([{ value: 0 }, { value: 10 }])).toBeNull();
  });

  it("handles negative values", () => {
    expect(getMeasurementTrend([{ value: -100 }, { value: -50 }])).toBe("up");
    expect(getMeasurementTrend([{ value: -100 }, { value: -150 }])).toBe("down");
  });
});
