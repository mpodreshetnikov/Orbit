import * as femaleFront from "./paths/female-front";
import * as maleFront from "./paths/male-front";

export type BodyModel = "male" | "female";

export interface BodyRegion {
  /** Stable region id, also the key into REGION_PATHS / REGION_ANCHORS. */
  id: string;
  /** i18n key for the region's display name. */
  labelKey: string;
}

export interface Anchor {
  x: number;
  y: number;
  gutter: "left" | "right";
}

export interface BodyArtwork {
  viewBox: string;
  silhouette: string;
  regionPaths: Record<string, string[]>;
  anchors: Record<string, Anchor>;
}

/**
 * Regions we render on the body, in top-to-bottom order.
 *
 * Every one of these is reachable from the front, which is why there is no back
 * view. Adding one later means a second pair of path files, a `view` key here
 * and on the anchors, and a toggle in the container's controls row.
 */
export const BODY_REGIONS: BodyRegion[] = [
  { id: "neck", labelKey: "measurements.bodyRegions.neck" },
  { id: "shoulders", labelKey: "measurements.bodyRegions.shoulders" },
  { id: "chest", labelKey: "measurements.bodyRegions.chest" },
  { id: "bicep_left", labelKey: "measurements.bodyRegions.bicepLeft" },
  { id: "bicep_right", labelKey: "measurements.bodyRegions.bicepRight" },
  { id: "forearm_left", labelKey: "measurements.bodyRegions.forearmLeft" },
  { id: "forearm_right", labelKey: "measurements.bodyRegions.forearmRight" },
  { id: "waist", labelKey: "measurements.bodyRegions.waist" },
  { id: "hips", labelKey: "measurements.bodyRegions.hips" },
  { id: "thigh_left", labelKey: "measurements.bodyRegions.thighLeft" },
  { id: "thigh_right", labelKey: "measurements.bodyRegions.thighRight" },
  { id: "calf_left", labelKey: "measurements.bodyRegions.calfLeft" },
  { id: "calf_right", labelKey: "measurements.bodyRegions.calfRight" },
];

export const BODY_REGION_IDS: string[] = BODY_REGIONS.map((region) => region.id);

/**
 * Regions authored by us rather than vendored. They are plain bands, so they
 * are clipped to the silhouette when rendered — see the `<clipPath>` in
 * body-map.tsx.
 */
export const BAND_REGIONS: ReadonlySet<string> = new Set(["waist", "hips"]);

/** measurement_catalog.code -> BodyRegion.id */
export const CODE_TO_REGION: Record<string, string> = {
  neck: "neck",
  shoulders: "shoulders",
  chest: "chest",
  waist: "waist",
  hips: "hips",
  bicep_left: "bicep_left",
  bicep_right: "bicep_right",
  forearm_left: "forearm_left",
  forearm_right: "forearm_right",
  thigh_left: "thigh_left",
  thigh_right: "thigh_right",
  calf_left: "calf_left",
  calf_right: "calf_right",
};

/**
 * BodyRegion.id -> measurement_catalog.code.
 *
 * Needed so a region with no readings yet can still open the add dialog scoped
 * to the right measurement type — the person's summaries only cover codes they
 * already have values for.
 */
export const REGION_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(CODE_TO_REGION).map(([code, regionId]) => [regionId, code]),
);

/**
 * Real measurements with no place on the body — they describe the whole person,
 * so they render in the stats strip beside the map instead.
 */
export const WHOLE_BODY_CODES: readonly string[] = [
  "height",
  "weight",
  "bmi",
  "body_fat",
  "muscle_mass",
];

const ARTWORK: Record<BodyModel, BodyArtwork> = {
  male: {
    viewBox: maleFront.VIEW_BOX,
    silhouette: maleFront.SILHOUETTE,
    regionPaths: maleFront.REGION_PATHS,
    anchors: maleFront.REGION_ANCHORS,
  },
  female: {
    viewBox: femaleFront.VIEW_BOX,
    silhouette: femaleFront.SILHOUETTE,
    regionPaths: femaleFront.REGION_PATHS,
    anchors: femaleFront.REGION_ANCHORS,
  },
};

export function getBodyArtwork(model: BodyModel): BodyArtwork {
  return ARTWORK[model];
}

/**
 * Which model to draw for a person. `Person.sex` is nullable and allows
 * "other", so anything that is not explicitly female falls back to the male
 * artwork; the container exposes a manual toggle so the fallback is never a
 * dead end.
 */
export function getBodyModelForSex(sex: string | null | undefined): BodyModel {
  return sex === "female" ? "female" : "male";
}

/** Parses "0 0 724 1448" into the numbers the overlay needs. */
export function parseViewBox(viewBox: string): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  const [minX, minY, width, height] = viewBox.split(/\s+/).map(Number);
  return { minX, minY, width, height };
}

/** Converts an anchor into percentages of the rendered box, for HTML overlays. */
export function anchorToPercent(anchor: Anchor, viewBox: string): { x: number; y: number } {
  const { minX, minY, width, height } = parseViewBox(viewBox);
  return {
    x: ((anchor.x - minX) / width) * 100,
    y: ((anchor.y - minY) / height) * 100,
  };
}
