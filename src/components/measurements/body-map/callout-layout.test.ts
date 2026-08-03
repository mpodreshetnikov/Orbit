import { describe, it, expect } from "vitest";
import { layoutOnBodyLabels, type CalloutInput } from "./callout-layout";
import { EDGE_PADDING_PCT, LABEL_HEIGHT_PCT, LABEL_WIDTH_PCT } from "./body-map-callouts";
import { BODY_REGION_IDS, getBodyArtwork, parseViewBox } from "./regions";

const BOX = { viewBox: { minX: 0, minY: 0, width: 100, height: 100 } };
const SIZE = { labelWidthPct: 20, labelHeightPct: 6 };

function input(regionId: string, x: number, y: number): CalloutInput {
  return { regionId, anchor: { x, y, gutter: "left" } };
}

function overlaps(
  a: { leftPct: number; topPct: number },
  b: { leftPct: number; topPct: number },
  w = SIZE.labelWidthPct,
  h = SIZE.labelHeightPct,
) {
  return Math.abs(a.leftPct - b.leftPct) < w - 1e-9 && Math.abs(a.topPct - b.topPct) < h - 1e-9;
}

describe("layoutOnBodyLabels", () => {
  it("leaves a well-separated label exactly on its region", () => {
    const result = layoutOnBodyLabels([input("a", 30, 20), input("b", 70, 80)], {
      ...SIZE,
      ...BOX,
    });
    expect(result.map((l) => [l.leftPct, l.topPct])).toEqual([
      [30, 20],
      [70, 80],
    ]);
  });

  it("keeps the label horizontally on its region — only the height moves", () => {
    const result = layoutOnBodyLabels([input("a", 50, 40), input("b", 50, 42)], {
      ...SIZE,
      ...BOX,
    });
    for (const label of result) {
      expect(label.leftPct).toBe(label.anchorXPct);
    }
  });

  it("pushes overlapping labels apart", () => {
    const result = layoutOnBodyLabels([input("a", 50, 40), input("b", 50, 42)], {
      ...SIZE,
      ...BOX,
    });
    expect(overlaps(result[0], result[1])).toBe(false);
  });

  it("moves the upper label up and the lower label down", () => {
    const result = layoutOnBodyLabels([input("top", 50, 40), input("bottom", 50, 42)], {
      ...SIZE,
      ...BOX,
    });
    const top = result.find((l) => l.regionId === "top")!;
    const bottom = result.find((l) => l.regionId === "bottom")!;
    expect(top.topPct).toBeLessThan(40);
    expect(bottom.topPct).toBeGreaterThan(42);
  });

  it("ignores labels that are far enough apart horizontally", () => {
    const result = layoutOnBodyLabels([input("a", 20, 50), input("b", 60, 50)], {
      ...SIZE,
      ...BOX,
    });
    expect(result.every((l) => l.topPct === 50)).toBe(true);
  });

  it("remembers where the region actually was", () => {
    const result = layoutOnBodyLabels([input("a", 50, 40), input("b", 50, 41)], {
      ...SIZE,
      ...BOX,
    });
    expect(result.map((l) => l.anchorYPct).sort()).toEqual([40, 41]);
  });

  it("resolves a three-way pile-up", () => {
    const result = layoutOnBodyLabels(
      [input("a", 50, 50), input("b", 50, 51), input("c", 50, 52)],
      { ...SIZE, ...BOX },
    );
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        expect(overlaps(result[i], result[j])).toBe(false);
      }
    }
  });

  it("does not depend on input order", () => {
    const forward = layoutOnBodyLabels(
      [input("a", 50, 50), input("b", 50, 52), input("c", 50, 54)],
      { ...SIZE, ...BOX },
    );
    const backward = layoutOnBodyLabels(
      [input("c", 50, 54), input("b", 50, 52), input("a", 50, 50)],
      { ...SIZE, ...BOX },
    );
    expect(backward).toEqual(forward);
  });

  it("keeps labels inside the box", () => {
    const result = layoutOnBodyLabels([input("a", 50, 1), input("b", 50, 2)], {
      ...SIZE,
      ...BOX,
      edgePaddingPct: 2,
    });
    for (const label of result) {
      expect(label.topPct).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(label.topPct).toBeLessThanOrEqual(98 + 1e-9);
    }
  });

  it("accounts for a non-zero viewBox origin", () => {
    const result = layoutOnBodyLabels([input("a", 0, 60)], {
      ...SIZE,
      viewBox: { minX: -50, minY: -40, width: 100, height: 200 },
    });
    expect(result[0].leftPct).toBe(50);
    expect(result[0].anchorYPct).toBe(50);
  });

  it("returns nothing for no input", () => {
    expect(layoutOnBodyLabels([], { ...SIZE, ...BOX })).toEqual([]);
  });

  // The case that matters: all 13 labels drawn on the real artwork.
  describe.each(["male", "female"] as const)("all 13 regions on the %s body", (model) => {
    const artwork = getBodyArtwork(model);
    const { minX, minY, width, height } = parseViewBox(artwork.viewBox);
    const all: CalloutInput[] = BODY_REGION_IDS.map((regionId) => ({
      regionId,
      anchor: artwork.anchors[regionId],
    }));

    // Uses the component's real constants so the two cannot drift apart.
    const result = layoutOnBodyLabels(all, {
      labelWidthPct: LABEL_WIDTH_PCT,
      labelHeightPct: LABEL_HEIGHT_PCT,
      edgePaddingPct: EDGE_PADDING_PCT,
      viewBox: { minX, minY, width, height },
    });

    it("places every label without an overlap", () => {
      expect(result).toHaveLength(BODY_REGION_IDS.length);
      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          expect(
            overlaps(result[i], result[j], LABEL_WIDTH_PCT, LABEL_HEIGHT_PCT),
            `${result[i].regionId} overlaps ${result[j].regionId}`,
          ).toBe(false);
        }
      }
    });

    it("keeps left and right of a pair at the same height", () => {
      const by = new Map(result.map((l) => [l.regionId, l]));
      for (const part of ["bicep", "forearm", "thigh", "calf"]) {
        expect(by.get(`${part}_left`)!.topPct, `${part} is lopsided`).toBe(
          by.get(`${part}_right`)!.topPct,
        );
      }
    });

    it("keeps every label on the body it belongs to", () => {
      for (const label of result) {
        // Nothing should be flung far from its region — the point of the
        // design is that the value sits on the spot.
        expect(
          Math.abs(label.topPct - label.anchorYPct),
          `${label.regionId} drifted too far`,
        ).toBeLessThan(6);
        expect(label.topPct).toBeGreaterThanOrEqual(2 - 1e-9);
        expect(label.topPct).toBeLessThanOrEqual(98 + 1e-9);
      }
    });
  });
});
