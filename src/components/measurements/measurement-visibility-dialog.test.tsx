import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MeasurementSummary } from "@/types";
import { MeasurementVisibilityDialog } from "./measurement-visibility-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string;
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      id={id}
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

function measurement(overrides: Partial<MeasurementSummary> = {}): MeasurementSummary {
  return {
    code: "weight",
    catalog_id: "cat-1",
    name_ru: "Вес",
    name_en: "Weight",
    unit_ru: "кг",
    unit_en: "kg",
    category: "basic",
    sort_order: 1,
    latest_value: 70,
    latest_date: "2026-01-02",
    measurement_count: 1,
    history: [],
    ...overrides,
  };
}

const WEIGHT = measurement();
const HEIGHT = measurement({
  code: "height",
  name_en: "Height",
  name_ru: "Рост",
  unit_en: "cm",
  unit_ru: "см",
  sort_order: 2,
});
const BICEP = measurement({
  code: "bicep_left",
  name_en: "Left bicep",
  name_ru: "Левый бицепс",
  unit_en: "cm",
  unit_ru: "см",
  category: "limbs",
  sort_order: 1,
});

function renderDialog(
  props: Partial<React.ComponentProps<typeof MeasurementVisibilityDialog>> = {},
) {
  const onToggle = vi.fn();
  render(
    <MeasurementVisibilityDialog
      open
      onOpenChange={vi.fn()}
      measurements={[WEIGHT, HEIGHT, BICEP]}
      hiddenCodes={new Set()}
      onToggle={onToggle}
      locale="en"
      {...props}
    />,
  );
  return { onToggle };
}

describe("MeasurementVisibilityDialog", () => {
  it("renders nothing while closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByText("Weight")).not.toBeInTheDocument();
  });

  it("lists every measurement grouped by category", () => {
    renderDialog();

    expect(screen.getByText(/Weight/)).toBeInTheDocument();
    expect(screen.getByText(/Height/)).toBeInTheDocument();
    expect(screen.getByText(/Left bicep/)).toBeInTheDocument();
    // Category headings, and no heading for categories with no entries.
    expect(screen.getByText("Basic")).toBeInTheDocument();
    expect(screen.getByText("Limbs")).toBeInTheDocument();
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("checks visible measurements and unchecks hidden ones", () => {
    renderDialog({ hiddenCodes: new Set(["height"]) });

    expect(screen.getByLabelText(/Weight/)).toBeChecked();
    expect(screen.getByLabelText(/Height/)).not.toBeChecked();
  });

  it("reports the toggled code", async () => {
    const { onToggle } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(/Height/));

    expect(onToggle).toHaveBeenCalledWith("height");
  });

  it("unhides through the same control", async () => {
    const { onToggle } = renderDialog({ hiddenCodes: new Set(["height"]) });
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(/Height/));

    expect(onToggle).toHaveBeenCalledWith("height");
  });

  it("uses Russian names and units when the locale is ru", () => {
    renderDialog({ locale: "ru" });

    expect(screen.getByText(/Вес/)).toBeInTheDocument();
    expect(screen.getByText(/Левый бицепс/)).toBeInTheDocument();
    expect(screen.queryByText(/Weight/)).not.toBeInTheDocument();
  });

  it("renders no groups when the person has no measurements", () => {
    renderDialog({ measurements: [] });

    expect(screen.getByText("measurements.visibilityTitle")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
