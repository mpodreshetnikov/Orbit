import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeasurementSummary, Person } from "@/types";
import { BodyMeasurementsView } from "./body-measurements-view";
import { BODY_REGION_IDS } from "./regions";

const hookMocks = vi.hoisted(() => ({ usePersons: vi.fn() }));
const dialogMock = vi.hoisted(() => ({ lastProps: {} as Record<string, unknown> }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  usePersons: () => hookMocks.usePersons(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href as string} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("../add-measurement-dialog", () => ({
  AddMeasurementDialog: (props: Record<string, unknown>) => {
    dialogMock.lastProps = props;
    return props.open ? <div>add-dialog:{String(props.preselectedCode)}</div> : null;
  },
}));

function summary(overrides: Partial<MeasurementSummary> & { code: string }): MeasurementSummary {
  return {
    catalog_id: `cat-${overrides.code}`,
    name_ru: `ru-${overrides.code}`,
    name_en: `en-${overrides.code}`,
    unit_ru: "см",
    unit_en: "cm",
    category: "body",
    sort_order: 1,
    latest_value: 40,
    latest_date: "2026-01-02",
    measurement_count: 2,
    history: [
      { id: "a", value: 38, measured_at: "2026-01-01", notes: null, created_at: "2026-01-01" },
      { id: "b", value: 40, measured_at: "2026-01-02", notes: null, created_at: "2026-01-02" },
    ],
    ...overrides,
  };
}

function person(sex: Person["sex"]): Person {
  return {
    id: "person-1",
    name: "Sam",
    kind: "human",
    species: null,
    breed: null,
    sex,
    birthday: null,
    notes: null,
    auth_user_id: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

function renderView(
  measurements: MeasurementSummary[] = [],
  {
    sex = "male" as Person["sex"],
    locale = "en",
    hiddenCodes = undefined as ReadonlySet<string> | undefined,
  } = {},
) {
  hookMocks.usePersons.mockReturnValue({ data: [person(sex)] });
  return render(
    <BodyMeasurementsView
      personId="person-1"
      measurements={measurements}
      hiddenCodes={hiddenCodes}
      locale={locale}
    />,
  );
}

describe("BodyMeasurementsView", () => {
  beforeEach(() => {
    dialogMock.lastProps = {};
  });

  it("labels which half of the body is the person's right and which is their left", () => {
    renderView([]);
    expect(screen.getByText("measurements.sideRight")).toBeInTheDocument();
    expect(screen.getByText("measurements.sideLeft")).toBeInTheDocument();
  });

  it("draws a chip for every region even with no data at all", () => {
    const { container } = renderView([]);
    expect(container.querySelectorAll("[data-region-id][style]")).toHaveLength(
      BODY_REGION_IDS.length,
    );
  });

  it("shows the latest value on the region, with the unit in the spoken label", () => {
    const { container } = renderView([summary({ code: "chest", latest_value: 102 })]);
    const label = container.querySelector<HTMLElement>('button[data-region-id="chest"]')!;
    expect(label).toHaveTextContent("102");
    expect(label.getAttribute("aria-label")).toContain("102 cm");
  });

  describe("accessible names", () => {
    // The region on the silhouette and its chip are two separate targets that
    // do the same thing, so both carry the label — hence getAllByRole.
    it("speaks the value, unit and direction of a measured region", () => {
      renderView([summary({ code: "chest", name_en: "Chest", latest_value: 102, unit_en: "cm" })]);
      // history rises 38 -> 102, so the direction is "rising"
      const label = "Chest, 102 cm, measurements.a11y.rising";
      expect(screen.getAllByRole("button", { name: label })).toHaveLength(2);
    });

    it("announces the add action on a region with no reading", () => {
      renderView([]);
      const label = "measurements.bodyRegions.waist, measurements.a11y.noValueAdd";
      expect(screen.getAllByRole("button", { name: label })).toHaveLength(2);
    });

    it("gives the SVG region the same spoken label as its chip", () => {
      const { container } = renderView([summary({ code: "chest", name_en: "Chest" })]);
      const region = container.querySelector('svg [data-region-id="chest"]')!;
      expect(region.getAttribute("aria-label")).toMatch(/^Chest, 40 cm,/);
    });

    it("speaks stats rows too", () => {
      renderView([summary({ code: "weight", name_en: "Weight", latest_value: 70, unit_en: "kg" })]);
      expect(
        screen.getByRole("button", { name: "Weight, 70 kg, measurements.a11y.rising" }),
      ).toBeInTheDocument();
    });
  });

  // Cards and Table already drop hidden codes. The body has to be told
  // separately, because its region list is fixed rather than data-driven — an
  // unmeasured region still gets an "Add" label, so filtering the data alone
  // would leave a hidden site showing here after it vanished from the lists.
  describe("hidden measurements", () => {
    it("leaves a hidden site off the body entirely", () => {
      const { container } = renderView([], { hiddenCodes: new Set(["calf_left"]) });
      expect(container.querySelector('button[data-region-id="calf_left"]')).toBeNull();
    });

    it("keeps every other site exactly where it was", () => {
      const { container } = renderView([], { hiddenCodes: new Set(["calf_left"]) });
      expect(container.querySelectorAll("button[data-region-id]")).toHaveLength(
        BODY_REGION_IDS.length - 1,
      );
      expect(container.querySelector('button[data-region-id="calf_right"]')).not.toBeNull();
    });

    it("shows everything when nothing is hidden", () => {
      const { container } = renderView([]);
      expect(container.querySelectorAll("button[data-region-id]")).toHaveLength(
        BODY_REGION_IDS.length,
      );
    });
  });

  it("marks a measured region's trend on the body", () => {
    const { container } = renderView([summary({ code: "chest" })]);
    expect(container.querySelector('svg [data-region-id="chest"]')).toHaveAttribute(
      "data-tone",
      "up",
    );
    expect(container.querySelector('svg [data-region-id="hips"]')).toHaveAttribute(
      "data-tone",
      "empty",
    );
  });

  it("opens the add dialog scoped to the tapped region", async () => {
    const user = userEvent.setup();
    const { container } = renderView([summary({ code: "chest" })]);

    await user.click(container.querySelector('svg [data-region-id="bicep_left"]')!);

    expect(screen.getByText("add-dialog:bicep_left")).toBeInTheDocument();
    expect(dialogMock.lastProps.personId).toBe("person-1");
  });

  it("opens the add dialog from an empty region too", async () => {
    const user = userEvent.setup();
    const { container } = renderView([]);

    await user.click(container.querySelector<HTMLElement>('button[data-region-id="waist"]')!);

    expect(screen.getByText("add-dialog:waist")).toBeInTheDocument();
  });

  it("closes the dialog and clears the scoped code", async () => {
    const user = userEvent.setup();
    const { container } = renderView([]);
    await user.click(container.querySelector('svg [data-region-id="neck"]')!);
    expect(screen.getByText("add-dialog:neck")).toBeInTheDocument();

    act(() => {
      (dialogMock.lastProps.onOpenChange as (open: boolean) => void)(false);
    });
    expect(screen.queryByText(/add-dialog/)).not.toBeInTheDocument();
  });

  describe("model selection", () => {
    it.each([
      ["female", "body-map-female"],
      ["male", "body-map-male"],
      ["other", "body-map-male"],
      [null, "body-map-male"],
    ])("draws %s as %s", (sex, expected) => {
      const { container } = renderView([], { sex: sex as Person["sex"] });
      expect(container.querySelector(`svg[aria-label="${expected}"]`)).toBeInTheDocument();
    });

    it("lets the fallback be overridden", async () => {
      const user = userEvent.setup();
      const { container } = renderView([], { sex: null });
      await user.click(screen.getByRole("tab", { name: "measurements.modelFemale" }));
      expect(container.querySelector('svg[aria-label="body-map-female"]')).toBeInTheDocument();
    });
  });

  describe("stats strip", () => {
    it("lists whole-body measurements beside the map, not on it", () => {
      const { container } = renderView([
        summary({ code: "weight", latest_value: 70, unit_en: "kg" }),
      ]);
      expect(screen.getByText("measurements.wholeBody")).toBeInTheDocument();
      expect(screen.getByText("70")).toBeInTheDocument();
      expect(container.querySelector('[data-region-id="weight"]')).toBeNull();
    });

    it("lists a custom catalog code rather than dropping it", () => {
      renderView([summary({ code: "wingspan", name_en: "Wingspan", latest_value: 180 })]);
      expect(screen.getByText("measurements.otherMeasurements")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Wingspan" })).toBeInTheDocument();
    });

    it("opens the add dialog from a stats row", async () => {
      const user = userEvent.setup();
      renderView([summary({ code: "weight", name_en: "Weight" })]);
      await user.click(screen.getByRole("button", { name: /^Weight,/ }));
      expect(screen.getByText("add-dialog:weight")).toBeInTheDocument();
    });

    it("stays out of the way when there is nothing to put in it", () => {
      renderView([summary({ code: "chest" })]);
      expect(screen.queryByText("measurements.wholeBody")).not.toBeInTheDocument();
      expect(screen.queryByText("measurements.otherMeasurements")).not.toBeInTheDocument();
    });
  });

  describe("locale", () => {
    it("uses the catalog's Russian names", () => {
      const { container } = renderView([summary({ code: "chest" })], { locale: "ru" });
      const label = container.querySelector<HTMLElement>('button[data-region-id="chest"]')!;
      // The on-body label is just the value; name and unit live in the tooltip
      // and the spoken label.
      expect(label).toHaveAttribute("title", "ru-chest");
      expect(label.getAttribute("aria-label")).toContain("см");
    });

    it("falls back to the region's own label when the person has no reading", () => {
      const { container } = renderView([]);
      const label = container.querySelector<HTMLElement>('button[data-region-id="chest"]')!;
      expect(label).toHaveAttribute("title", "measurements.bodyRegions.chest");
    });
  });
});
