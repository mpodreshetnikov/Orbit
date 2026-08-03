import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BodyMap } from "./body-map";
import { BODY_REGION_IDS } from "./regions";

function renderMap(overrides: Partial<React.ComponentProps<typeof BodyMap>> = {}) {
  const onRegionSelect = vi.fn();
  const utils = render(
    <BodyMap
      model="male"
      tones={{}}
      onRegionSelect={onRegionSelect}
      regionLabel={(regionId) => `label:${regionId}`}
      {...overrides}
    />,
  );
  return { ...utils, onRegionSelect };
}

describe("BodyMap", () => {
  it("renders every region", () => {
    const { container } = renderMap();
    const groups = container.querySelectorAll("[data-region-id]");
    expect(groups).toHaveLength(BODY_REGION_IDS.length);
  });

  it("labels regions with the caller's translation", () => {
    renderMap();
    expect(screen.getByLabelText("label:bicep_left")).toBeInTheDocument();
    expect(screen.getByLabelText("label:waist")).toBeInTheDocument();
  });

  it("calls back with the region id on click", async () => {
    const user = userEvent.setup();
    const { onRegionSelect } = renderMap();
    await user.click(screen.getByLabelText("label:chest"));
    expect(onRegionSelect).toHaveBeenCalledWith("chest");
  });

  it.each([
    ["{Enter}", "Enter"],
    [" ", "Space"],
  ])("calls back on %s", async (key) => {
    const user = userEvent.setup();
    const { onRegionSelect } = renderMap();
    screen.getByLabelText("label:hips").focus();
    await user.keyboard(key);
    expect(onRegionSelect).toHaveBeenCalledWith("hips");
  });

  it("exposes regions to the keyboard", () => {
    const { container } = renderMap();
    for (const group of container.querySelectorAll("[data-region-id]")) {
      expect(group.getAttribute("tabindex")).toBe("0");
      expect(group.getAttribute("role")).toBe("button");
    }
  });

  it("defaults regions with no reading to the empty tone", () => {
    const { container } = renderMap({ tones: { chest: "up" } });
    expect(container.querySelector('[data-region-id="chest"]')).toHaveAttribute("data-tone", "up");
    expect(container.querySelector('[data-region-id="hips"]')).toHaveAttribute(
      "data-tone",
      "empty",
    );
  });

  it("distinguishes the four tones by fill", () => {
    const { container } = renderMap({
      tones: { chest: "up", waist: "down", hips: "flat" },
    });
    const fillOf = (regionId: string) =>
      container.querySelector(`[data-region-id="${regionId}"] path`)?.getAttribute("fill");

    const fills = [fillOf("chest"), fillOf("waist"), fillOf("hips"), fillOf("neck")];
    expect(new Set(fills).size).toBe(4);
  });

  it("marks only the active region", () => {
    const { container } = renderMap({ activeRegionId: "waist" });
    expect(container.querySelector('[data-region-id="waist"]')).toHaveAttribute("data-active");
    expect(container.querySelector('[data-region-id="chest"]')).not.toHaveAttribute("data-active");
  });

  it("clips the band regions to the silhouette but not the vendored ones", () => {
    const { container } = renderMap();
    expect(container.querySelector('[data-region-id="waist"]')).toHaveAttribute("clip-path");
    expect(container.querySelector('[data-region-id="hips"]')).toHaveAttribute("clip-path");
    expect(container.querySelector('[data-region-id="chest"]')).not.toHaveAttribute("clip-path");
  });

  it("draws the female artwork when asked", () => {
    const { container } = renderMap({ model: "female" });
    expect(container.querySelector("svg")).toHaveAttribute("aria-label", "body-map-female");
    expect(container.querySelectorAll("[data-region-id]")).toHaveLength(BODY_REGION_IDS.length);
  });

  it("gives each model its own clip path id", () => {
    const male = renderMap().container.querySelector("clipPath")?.id;
    const female = renderMap({ model: "female" }).container.querySelector("clipPath")?.id;
    expect(male).not.toBe(female);
  });
});
