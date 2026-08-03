import { MEASUREMENT_CATEGORIES, type MeasurementCategory } from "@/types";

/**
 * Shared ordering rules for measurement types.
 *
 * Used by both the person measurement list and the catalog, so the add dialog
 * dropdown, the catalog admin screen and the measurements page all agree.
 */

export type MeasurementSide = "left" | "right";

export interface OrderableMeasurement {
  code: string;
  category: MeasurementCategory;
  sort_order: number;
  name_en: string;
}

const SIDE_SUFFIXES: Record<string, MeasurementSide> = {
  _left: "left",
  _right: "right",
};

const SIDE_RANK: Record<MeasurementSide, number> = {
  left: 0,
  right: 1,
};

/**
 * Splits a catalog code into its body part and laterality, e.g.
 * `bicep_left` -> `{ baseCode: "bicep", side: "left" }`.
 * Codes without a side suffix return `{ baseCode: code, side: null }`.
 */
export function parseMeasurementCode(code: string): {
  baseCode: string;
  side: MeasurementSide | null;
} {
  for (const [suffix, side] of Object.entries(SIDE_SUFFIXES)) {
    if (code.endsWith(suffix)) {
      return { baseCode: code.slice(0, -suffix.length), side };
    }
  }
  return { baseCode: code, side: null };
}

function categoryRank(category: MeasurementCategory): number {
  const index = MEASUREMENT_CATEGORIES.indexOf(category);
  return index === -1 ? MEASUREMENT_CATEGORIES.length : index;
}

/**
 * Orders measurements by category, then by the catalog's `sort_order`, which is
 * seeded so paired body parts sit next to each other (bicep_left, bicep_right,
 * forearm_left, forearm_right, ...).
 *
 * The baseCode/side tiebreaker keeps pairs together for catalog rows created
 * through the admin UI, which default `sort_order` to 0 -- without it every
 * custom row ties, falls back to name, and all the "Left ..." entries sort
 * ahead of all the "Right ..." ones again.
 *
 * Known limitation: if the two halves of a pair carry different `sort_order`
 * values, `sort_order` wins and the pair splits. Grouping by baseCode and
 * anchoring on the pair's minimum would fix that, but the seeded data does not
 * need it.
 */
export function compareMeasurementOrder(a: OrderableMeasurement, b: OrderableMeasurement): number {
  const categoryDelta = categoryRank(a.category) - categoryRank(b.category);
  if (categoryDelta !== 0) return categoryDelta;

  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;

  const parsedA = parseMeasurementCode(a.code);
  const parsedB = parseMeasurementCode(b.code);

  if (parsedA.baseCode !== parsedB.baseCode) {
    return parsedA.baseCode.localeCompare(parsedB.baseCode);
  }

  // Same body part: unsided first, then left, then right.
  const sideA = parsedA.side === null ? -1 : SIDE_RANK[parsedA.side];
  const sideB = parsedB.side === null ? -1 : SIDE_RANK[parsedB.side];
  if (sideA !== sideB) return sideA - sideB;

  return a.name_en.localeCompare(b.name_en);
}

/** Returns a new array sorted with {@link compareMeasurementOrder}. */
export function sortByMeasurementOrder<T extends OrderableMeasurement>(items: T[]): T[] {
  return [...items].sort(compareMeasurementOrder);
}
