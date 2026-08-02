import { describe, expect, it } from "vitest";
import {
  hiddenCodesForPerson,
  normalizeHiddenMeasurementCodes,
  toggleHiddenCode,
} from "./measurement-visibility";

describe("normalizeHiddenMeasurementCodes", () => {
  it("passes through a well-formed map", () => {
    expect(normalizeHiddenMeasurementCodes({ "p-1": ["height", "bmi"] })).toEqual({
      "p-1": ["height", "bmi"],
    });
  });

  it("tolerates values a hand-edited jsonb column could hold", () => {
    expect(normalizeHiddenMeasurementCodes(null)).toEqual({});
    expect(normalizeHiddenMeasurementCodes(undefined)).toEqual({});
    expect(normalizeHiddenMeasurementCodes({})).toEqual({});
    expect(normalizeHiddenMeasurementCodes("height")).toEqual({});
    expect(normalizeHiddenMeasurementCodes(42)).toEqual({});
    expect(normalizeHiddenMeasurementCodes(["height"])).toEqual({});
  });

  it("drops person keys whose value is not an array", () => {
    expect(normalizeHiddenMeasurementCodes({ "p-1": "height", "p-2": ["bmi"] })).toEqual({
      "p-2": ["bmi"],
    });
  });

  it("drops non-string entries and empty lists", () => {
    expect(normalizeHiddenMeasurementCodes({ "p-1": ["height", 5, null], "p-2": [] })).toEqual({
      "p-1": ["height"],
    });
  });

  it("de-duplicates codes", () => {
    expect(normalizeHiddenMeasurementCodes({ "p-1": ["height", "height"] })).toEqual({
      "p-1": ["height"],
    });
  });
});

describe("hiddenCodesForPerson", () => {
  const hidden = { "p-1": ["height"], "p-2": ["bmi", "pulse"] };

  it("returns only the requested person's codes", () => {
    expect([...hiddenCodesForPerson(hidden, "p-2")].sort()).toEqual(["bmi", "pulse"]);
  });

  it("returns an empty set for an unknown or missing person", () => {
    expect(hiddenCodesForPerson(hidden, "p-9").size).toBe(0);
    expect(hiddenCodesForPerson(hidden, null).size).toBe(0);
  });
});

describe("toggleHiddenCode", () => {
  it("hides a code that was visible", () => {
    expect(toggleHiddenCode({}, "p-1", "height")).toEqual({ "p-1": ["height"] });
  });

  it("unhides a code that was hidden", () => {
    expect(toggleHiddenCode({ "p-1": ["height", "bmi"] }, "p-1", "height")).toEqual({
      "p-1": ["bmi"],
    });
  });

  it("drops the person key once nothing is hidden", () => {
    expect(toggleHiddenCode({ "p-1": ["height"] }, "p-1", "height")).toEqual({});
  });

  it("leaves other people untouched", () => {
    expect(toggleHiddenCode({ "p-1": ["height"], "p-2": ["bmi"] }, "p-1", "pulse")).toEqual({
      "p-1": ["height", "pulse"],
      "p-2": ["bmi"],
    });
  });

  it("does not mutate the input", () => {
    const original = { "p-1": ["height"] };
    toggleHiddenCode(original, "p-1", "bmi");
    expect(original).toEqual({ "p-1": ["height"] });
  });

  it("round-trips back to the starting state", () => {
    const once = toggleHiddenCode({ "p-1": ["bmi"] }, "p-1", "height");
    expect(toggleHiddenCode(once, "p-1", "height")).toEqual({ "p-1": ["bmi"] });
  });
});
