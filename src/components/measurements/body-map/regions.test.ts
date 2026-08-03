import { describe, it, expect } from "vitest";
import {
  BAND_REGIONS,
  BODY_REGIONS,
  BODY_REGION_IDS,
  CODE_TO_REGION,
  WHOLE_BODY_CODES,
  anchorToPercent,
  getBodyArtwork,
  getBodyModelForSex,
  parseViewBox,
  type BodyModel,
} from "./regions";

/** Every code seeded by 20250128000001_create_measurements.sql. */
const SEEDED_CATALOG_CODES = [
  "height",
  "weight",
  "neck",
  "shoulders",
  "chest",
  "waist",
  "hips",
  "bicep_left",
  "bicep_right",
  "forearm_left",
  "forearm_right",
  "thigh_left",
  "thigh_right",
  "calf_left",
  "calf_right",
  "body_fat",
  "muscle_mass",
  "bmi",
];

const MODELS: BodyModel[] = ["male", "female"];

describe("region taxonomy", () => {
  it("accounts for every seeded catalog code", () => {
    const unaccounted = SEEDED_CATALOG_CODES.filter(
      (code) => !CODE_TO_REGION[code] && !WHOLE_BODY_CODES.includes(code),
    );
    expect(unaccounted).toEqual([]);
  });

  it("maps every code to a region that exists", () => {
    for (const regionId of Object.values(CODE_TO_REGION)) {
      expect(BODY_REGION_IDS).toContain(regionId);
    }
  });

  it("has a region for every declared body region and no duplicates", () => {
    expect(new Set(BODY_REGION_IDS).size).toBe(BODY_REGIONS.length);
  });

  it("gives every region a distinct label key", () => {
    const keys = BODY_REGIONS.map((region) => region.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not place whole-body codes on the body", () => {
    for (const code of WHOLE_BODY_CODES) {
      expect(CODE_TO_REGION[code]).toBeUndefined();
    }
  });
});

describe.each(MODELS)("artwork: %s", (model) => {
  const artwork = getBodyArtwork(model);

  it("has a non-empty silhouette and a parseable viewBox", () => {
    expect(artwork.silhouette.length).toBeGreaterThan(100);
    const { width, height } = parseViewBox(artwork.viewBox);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  // The viewBox is fitted to the artwork, not copied from upstream. Upstream's
  // boxes leave the body starting ~11% (male) and ~8% (female) down, which
  // renders as a gap between the side header and the head. Every other
  // assertion here is about relative position, so all of them would still pass
  // with the loose box -- this is the only thing standing between a
  // regeneration and that whitespace coming back. See the "Regenerating"
  // section of paths/LICENSE-ATTRIBUTION.md.
  it("uses the fitted viewBox, not upstream's padded one", () => {
    const upstream = { male: "0 0 724 1448", female: "-50 -40 734 1538" };
    const fitted = { male: "42 158 646 1201", female: "-6 82 655 1357" };

    expect(artwork.viewBox).not.toBe(upstream[model]);
    expect(artwork.viewBox).toBe(fitted[model]);
  });

  it("has paths for every region", () => {
    for (const regionId of BODY_REGION_IDS) {
      const paths = artwork.regionPaths[regionId];
      expect(paths, `${model} is missing paths for ${regionId}`).toBeDefined();
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("has an anchor for every region, inside the viewBox", () => {
    const { minX, minY, width, height } = parseViewBox(artwork.viewBox);
    for (const regionId of BODY_REGION_IDS) {
      const anchor = artwork.anchors[regionId];
      expect(anchor, `${model} is missing an anchor for ${regionId}`).toBeDefined();
      expect(anchor.x).toBeGreaterThanOrEqual(minX);
      expect(anchor.x).toBeLessThanOrEqual(minX + width);
      expect(anchor.y).toBeGreaterThanOrEqual(minY);
      expect(anchor.y).toBeLessThanOrEqual(minY + height);
    }
  });

  it("carries no artwork for regions we do not render", () => {
    for (const regionId of Object.keys(artwork.regionPaths)) {
      expect(BODY_REGION_IDS).toContain(regionId);
    }
  });

  // Upstream's left/right are viewer-relative. On a front view the viewer's
  // right is the person's left, so this guards against the swap being undone.
  it.each(["bicep", "forearm", "thigh", "calf"])(
    "puts the person's left %s on the viewer's right",
    (part) => {
      const { minX, width } = parseViewBox(artwork.viewBox);
      const centre = minX + width / 2;
      expect(artwork.anchors[`${part}_left`].x).toBeGreaterThan(centre);
      expect(artwork.anchors[`${part}_right`].x).toBeLessThan(centre);
    },
  );

  it("lines paired limbs up at the same height", () => {
    for (const part of ["bicep", "forearm", "thigh", "calf"]) {
      expect(artwork.anchors[`${part}_left`].y).toBe(artwork.anchors[`${part}_right`].y);
    }
  });

  it("sends left-side regions to the left gutter and right-side to the right", () => {
    for (const part of ["bicep", "forearm", "thigh", "calf"]) {
      expect(artwork.anchors[`${part}_left`].gutter).toBe("right");
      expect(artwork.anchors[`${part}_right`].gutter).toBe("left");
    }
  });

  it("balances the two gutters", () => {
    const left = BODY_REGION_IDS.filter((id) => artwork.anchors[id].gutter === "left").length;
    const right = BODY_REGION_IDS.length - left;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it("orders regions head to toe", () => {
    const ys = BODY_REGION_IDS.map((id) => artwork.anchors[id].y);
    expect(artwork.anchors.neck.y).toBeLessThan(artwork.anchors.waist.y);
    expect(artwork.anchors.waist.y).toBeLessThan(artwork.anchors.hips.y);
    expect(artwork.anchors.hips.y).toBeLessThan(artwork.anchors.calf_left.y);
    expect(ys.every((y) => Number.isFinite(y))).toBe(true);
  });
});

describe("band regions", () => {
  it("covers exactly the sites upstream has no muscle for", () => {
    expect([...BAND_REGIONS].sort()).toEqual(["hips", "waist"]);
  });

  it("are all real regions", () => {
    for (const regionId of BAND_REGIONS) {
      expect(BODY_REGION_IDS).toContain(regionId);
    }
  });
});

describe("getBodyModelForSex", () => {
  it("draws the female model only for female", () => {
    expect(getBodyModelForSex("female")).toBe("female");
  });

  it.each([["male"], ["other"], [null], [undefined]])("falls back to male for %s", (sex) => {
    expect(getBodyModelForSex(sex as string | null | undefined)).toBe("male");
  });
});

describe("anchorToPercent", () => {
  it("maps the viewBox corners to 0% and 100%", () => {
    const viewBox = "0 0 200 400";
    expect(anchorToPercent({ x: 0, y: 0, gutter: "left" }, viewBox)).toEqual({ x: 0, y: 0 });
    expect(anchorToPercent({ x: 200, y: 400, gutter: "left" }, viewBox)).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("accounts for a non-zero viewBox origin", () => {
    // The female artwork starts at -50 -40, so the origin must be subtracted.
    const viewBox = "-50 -40 100 200";
    expect(anchorToPercent({ x: 0, y: 60, gutter: "left" }, viewBox)).toEqual({ x: 50, y: 50 });
  });
});
