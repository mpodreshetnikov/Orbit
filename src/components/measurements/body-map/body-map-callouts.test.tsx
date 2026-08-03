import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BodyMapPanel,
  EDGE_PADDING_PCT,
  LABEL_HEIGHT_PCT,
  LABEL_WIDTH_PCT,
  type CalloutItem,
} from "./body-map-callouts";
import { BODY_REGION_IDS, REGION_TO_CODE } from "./regions";

function item(overrides: Partial<CalloutItem> & { regionId: string }): CalloutItem {
  return {
    code: REGION_TO_CODE[overrides.regionId],
    name: overrides.regionId,
    ariaLabel: `spoken:${overrides.regionId}`,
    unit: "cm",
    value: 40,
    trend: null,
    ...overrides,
  };
}

const ALL_ITEMS = BODY_REGION_IDS.map((regionId) => item({ regionId }));

function renderPanel(overrides: Partial<React.ComponentProps<typeof BodyMapPanel>> = {}) {
  const onRegionSelect = vi.fn();
  const utils = render(
    <BodyMapPanel
      model="male"
      items={ALL_ITEMS}
      tones={{}}
      onRegionSelect={onRegionSelect}
      regionLabel={(regionId) => `label:${regionId}`}
      emptyLabel="no-value"
      sideLabels={{ left: "side-left", right: "side-right" }}
      {...overrides}
    />,
  );
  return { ...utils, onRegionSelect };
}

/** The positioned labels, i.e. the buttons overlaid on the body. */
function labels(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("button[data-region-id]")].map((el) => ({
    regionId: el.dataset.regionId!,
    left: Number.parseFloat(el.style.left),
    top: Number.parseFloat(el.style.top),
    el,
  }));
}

describe("BodyMapPanel", () => {
  describe("side header", () => {
    it("names both of the person's sides", () => {
      renderPanel();
      expect(screen.getByText("side-right")).toBeInTheDocument();
      expect(screen.getByText("side-left")).toBeInTheDocument();
    });

    // The body faces the viewer, so the person's right is drawn on the
    // viewer's left. If this order ever flips the map claims the wrong arm.
    it("puts the person's right over the viewer's left half", () => {
      const { container } = renderPanel();
      const header = container.querySelector('[data-testid="body-side-header"]')!;
      const words = [...header.querySelectorAll("span")].map((s) => s.textContent).filter(Boolean);
      expect(words).toEqual(["side-right", "side-left"]);
    });

    it("sits above the body, not inside the box the labels are positioned in", () => {
      const { container } = renderPanel();
      const header = container.querySelector('[data-testid="body-side-header"]')!;
      const positioned = container.querySelector("button[data-region-id]")!;
      // A label inside the header's subtree would mean the header is part of
      // the aspect-ratio box, which would shift every label off its muscle.
      expect(header.contains(positioned)).toBe(false);
    });
  });

  it("draws a label for every region, on top of the body", () => {
    const { container } = renderPanel();
    expect(labels(container)).toHaveLength(BODY_REGION_IDS.length);
    expect(container.querySelector('svg[aria-label="body-map-male"]')).toBeInTheDocument();
  });

  it("shows the value, without repeating the unit on every label", () => {
    const { container } = renderPanel({
      items: [item({ regionId: "chest", value: 102.5, unit: "cm" })],
    });
    const label = labels(container)[0].el;
    expect(label).toHaveTextContent("102.5");
    expect(label).not.toHaveTextContent("cm");
  });

  it("drops the decimal on whole values", () => {
    const { container } = renderPanel({ items: [item({ regionId: "chest", value: 102 })] });
    expect(labels(container)[0].el).toHaveTextContent("102");
  });

  it("names the region in the tooltip, since the label itself is only a value", () => {
    const { container } = renderPanel({ items: [item({ regionId: "chest", name: "Chest" })] });
    expect(labels(container)[0].el).toHaveAttribute("title", "Chest");
  });

  it("shows the empty label for a region with no reading", () => {
    const { container } = renderPanel({ items: [item({ regionId: "chest", value: null })] });
    expect(labels(container)[0].el).toHaveTextContent("no-value");
  });

  it("still lets an empty region be tapped — that is how a site is seeded", async () => {
    const user = userEvent.setup();
    const { container, onRegionSelect } = renderPanel({
      items: [item({ regionId: "chest", value: null })],
    });
    await user.click(labels(container)[0].el);
    expect(onRegionSelect).toHaveBeenCalledWith("chest");
  });

  it("gives the label the spoken name, not just the value", () => {
    renderPanel({
      items: [item({ regionId: "chest", ariaLabel: "Chest, 102 cm, rising" })],
    });
    expect(screen.getByRole("button", { name: "Chest, 102 cm, rising" })).toBeInTheDocument();
  });

  it("selects the region from the label as well as the body", async () => {
    const user = userEvent.setup();
    const { container, onRegionSelect } = renderPanel();
    const waist = labels(container).find((l) => l.regionId === "waist")!;
    await user.click(waist.el);
    expect(onRegionSelect).toHaveBeenCalledWith("waist");
  });

  it("puts each label on its own region, not in a column at the edge", () => {
    const { container } = renderPanel();
    const byId = new Map(labels(container).map((l) => [l.regionId, l]));

    // A left-side limb sits left of centre and a right-side one sits right,
    // which only holds if the label really is on the muscle.
    expect(byId.get("bicep_right")!.left).toBeLessThan(45);
    expect(byId.get("bicep_left")!.left).toBeGreaterThan(55);
    // And they sit at the same height as each other (both are nudged clear of
    // the chest label, so allow a hair of float drift).
    expect(Math.abs(byId.get("bicep_left")!.top - byId.get("bicep_right")!.top)).toBeLessThan(0.1);
    // Head-to-toe ordering survives.
    expect(byId.get("neck")!.top).toBeLessThan(byId.get("waist")!.top);
    expect(byId.get("waist")!.top).toBeLessThan(byId.get("calf_left")!.top);
  });

  it("never overlaps two labels, with all 13 regions", () => {
    const { container } = renderPanel();
    const placed = labels(container);

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const overlapping =
          Math.abs(placed[i].left - placed[j].left) < LABEL_WIDTH_PCT - 1e-6 &&
          Math.abs(placed[i].top - placed[j].top) < LABEL_HEIGHT_PCT - 1e-6;
        expect(overlapping, `${placed[i].regionId} overlaps ${placed[j].regionId}`).toBe(false);
      }
    }
  });

  it("keeps every label inside the body box", () => {
    const { container } = renderPanel();
    for (const { top } of labels(container)) {
      expect(top).toBeGreaterThanOrEqual(EDGE_PADDING_PCT - 1e-6);
      expect(top).toBeLessThanOrEqual(100 - EDGE_PADDING_PCT + 1e-6);
    }
  });

  it("repositions when the model changes", () => {
    const { container, rerender } = renderPanel();
    const before = labels(container).length;
    rerender(
      <BodyMapPanel
        model="female"
        items={ALL_ITEMS}
        tones={{}}
        onRegionSelect={vi.fn()}
        regionLabel={(regionId) => `label:${regionId}`}
        emptyLabel="no-value"
        sideLabels={{ left: "side-left", right: "side-right" }}
      />,
    );
    expect(labels(container)).toHaveLength(before);
    expect(container.querySelector('svg[aria-label="body-map-female"]')).toBeInTheDocument();
  });

  it("ignores an item with no anchor rather than crashing", () => {
    const { container } = renderPanel({
      items: [item({ regionId: "chest" }), item({ regionId: "not_a_region" })],
    });
    expect(labels(container)).toHaveLength(1);
  });
});
