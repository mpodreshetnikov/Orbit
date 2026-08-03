import { describe, expect, it } from "vitest";
import type { MeasurementCategory } from "@/types";
import {
  compareMeasurementOrder,
  parseMeasurementCode,
  sortByMeasurementOrder,
  type OrderableMeasurement,
} from "./measurement-order";

function item(
  code: string,
  sort_order: number,
  category: MeasurementCategory = "limbs",
  name_en = code,
): OrderableMeasurement {
  return { code, sort_order, category, name_en };
}

describe("parseMeasurementCode", () => {
  it("splits laterality suffixes off the body part", () => {
    expect(parseMeasurementCode("bicep_left")).toEqual({ baseCode: "bicep", side: "left" });
    expect(parseMeasurementCode("bicep_right")).toEqual({ baseCode: "bicep", side: "right" });
  });

  it("leaves unsided codes alone", () => {
    expect(parseMeasurementCode("weight")).toEqual({ baseCode: "weight", side: null });
  });

  it("only strips a trailing suffix", () => {
    expect(parseMeasurementCode("left_handed_grip")).toEqual({
      baseCode: "left_handed_grip",
      side: null,
    });
  });
});

describe("sortByMeasurementOrder", () => {
  it("keeps left/right pairs together using the seeded sort_order", () => {
    // The seeded limbs ordering, fed in scrambled.
    const scrambled = [
      item("calf_left", 7),
      item("thigh_right", 6),
      item("bicep_right", 2),
      item("forearm_left", 3),
      item("calf_right", 8),
      item("bicep_left", 1),
      item("thigh_left", 5),
      item("forearm_right", 4),
    ];

    expect(sortByMeasurementOrder(scrambled).map((m) => m.code)).toEqual([
      "bicep_left",
      "bicep_right",
      "forearm_left",
      "forearm_right",
      "thigh_left",
      "thigh_right",
      "calf_left",
      "calf_right",
    ]);
  });

  it("still pairs rows that all default to sort_order 0", () => {
    // Catalog rows created through the admin UI default sort_order to 0. Sorting
    // by name alone would yield every "Left ..." before every "Right ...".
    const customRows = [
      item("wrist_right", 0, "limbs", "Right wrist"),
      item("ankle_left", 0, "limbs", "Left ankle"),
      item("wrist_left", 0, "limbs", "Left wrist"),
      item("ankle_right", 0, "limbs", "Right ankle"),
    ];

    expect(sortByMeasurementOrder(customRows).map((m) => m.code)).toEqual([
      "ankle_left",
      "ankle_right",
      "wrist_left",
      "wrist_right",
    ]);
  });

  it("orders categories ahead of sort_order", () => {
    const mixed = [
      item("bicep_left", 1, "limbs"),
      item("body_fat", 9, "vital"),
      item("weight", 2, "basic"),
      item("chest", 1, "body"),
    ];

    expect(sortByMeasurementOrder(mixed).map((m) => m.category)).toEqual([
      "basic",
      "body",
      "limbs",
      "vital",
    ]);
  });

  it("puts an unsided code before its sided siblings", () => {
    const rows = [item("bicep_right", 0), item("bicep", 0), item("bicep_left", 0)];

    expect(sortByMeasurementOrder(rows).map((m) => m.code)).toEqual([
      "bicep",
      "bicep_left",
      "bicep_right",
    ]);
  });

  it("falls back to display name for otherwise identical rows", () => {
    const rows = [item("weight", 0, "basic", "Zebra"), item("weight", 0, "basic", "Alpha")];

    expect(sortByMeasurementOrder(rows).map((m) => m.name_en)).toEqual(["Alpha", "Zebra"]);
  });

  it("does not mutate the input array", () => {
    const rows = [item("bicep_right", 2), item("bicep_left", 1)];
    sortByMeasurementOrder(rows);
    expect(rows.map((m) => m.code)).toEqual(["bicep_right", "bicep_left"]);
  });
});

describe("compareMeasurementOrder", () => {
  it("is symmetric for a swapped pair", () => {
    const left = item("bicep_left", 1);
    const right = item("bicep_right", 2);
    expect(compareMeasurementOrder(left, right)).toBeLessThan(0);
    expect(compareMeasurementOrder(right, left)).toBeGreaterThan(0);
  });

  it("treats an identical row as equal", () => {
    expect(compareMeasurementOrder(item("weight", 1, "basic"), item("weight", 1, "basic"))).toBe(0);
  });
});
