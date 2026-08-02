import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementSummary } from "@/types";
import MeasurementsPage from "./page";

const hookMocks = vi.hoisted(() => ({
  usePersonMeasurements: vi.fn(),
  useHiddenMeasurements: vi.fn(),
}));

const toggleHidden = vi.fn();
let hiddenCodesState = new Set<string>();

let selectedPersonIdState: string | null = "person-1";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  usePersonMeasurements: (...args: unknown[]) => hookMocks.usePersonMeasurements(...args),
  useHiddenMeasurements: (...args: unknown[]) => hookMocks.useHiddenMeasurements(...args),
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/measurements/add-measurement-dialog", () => ({
  AddMeasurementDialog: ({ open }: { open?: boolean }) =>
    open ? <div>add-measurement-dialog</div> : null,
}));

vi.mock("@/components/measurements/measurement-visibility-dialog", () => ({
  MeasurementVisibilityDialog: ({
    open,
    measurements,
  }: {
    open?: boolean;
    measurements?: { code: string }[];
  }) =>
    open ? (
      <div>
        measurement-visibility-dialog
        <span data-testid="dialog-codes">{(measurements ?? []).map((m) => m.code).join(",")}</span>
      </div>
    ) : null,
}));

function makeMeasurement(overrides: Partial<MeasurementSummary> = {}): MeasurementSummary {
  return {
    code: "weight",
    catalog_id: "cat-1",
    name_ru: "Вес",
    name_en: "Weight",
    unit_ru: "кг",
    unit_en: "kg",
    category: "basic",
    sort_order: 1,
    latest_value: 70.2,
    latest_date: "2026-01-02",
    measurement_count: 2,
    history: [
      {
        id: "m-1",
        value: 70,
        measured_at: "2026-01-01T10:00:00.000Z",
        notes: null,
        created_at: "2026-01-01T10:00:00.000Z",
      },
      {
        id: "m-2",
        value: 70.2,
        measured_at: "2026-01-02T10:00:00.000Z",
        notes: "stable",
        created_at: "2026-01-02T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("MeasurementsPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    document.documentElement.lang = "en";
    toggleHidden.mockReset();
    hiddenCodesState = new Set<string>();
    hookMocks.useHiddenMeasurements.mockReset();
    hookMocks.useHiddenMeasurements.mockImplementation(() => ({
      hiddenCodes: hiddenCodesState,
      toggleHidden,
      isLoading: false,
      isToggling: false,
    }));
  });

  it("renders person prompt when no person is selected", () => {
    selectedPersonIdState = null;
    hookMocks.usePersonMeasurements.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<MeasurementsPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("renders loading and error states", () => {
    hookMocks.usePersonMeasurements.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    });
    const view = render(<MeasurementsPage />);
    expect(screen.getByText("measurements.title")).toBeInTheDocument();
    view.unmount();

    hookMocks.usePersonMeasurements.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error("boom"),
    });
    render(<MeasurementsPage />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
  });

  it("renders empty state and opens add dialog", async () => {
    hookMocks.usePersonMeasurements.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<MeasurementsPage />);
    const user = userEvent.setup();

    expect(screen.getByText("measurements.noData")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "measurements.addFirst" }));
    expect(screen.getByText("add-measurement-dialog")).toBeInTheDocument();
  });

  it("renders cards and switches to table view", async () => {
    hookMocks.usePersonMeasurements.mockReturnValue({
      data: [makeMeasurement()],
      isLoading: false,
      error: null,
    });

    render(<MeasurementsPage />);
    const user = userEvent.setup();

    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getAllByText(/measurements\.measurements/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: "measurements.tableView" }));
    expect(screen.getByText("measurements.value")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Weight" }).length).toBeGreaterThan(0);
  });

  describe("hidden measurements", () => {
    const weight = makeMeasurement();
    const height = makeMeasurement({
      code: "height",
      catalog_id: "cat-2",
      name_en: "Height",
      name_ru: "Рост",
      unit_en: "cm",
      unit_ru: "см",
      sort_order: 2,
      history: [
        {
          id: "h-1",
          value: 180,
          measured_at: "2026-01-01T10:00:00.000Z",
          notes: null,
          created_at: "2026-01-01T10:00:00.000Z",
        },
      ],
      measurement_count: 1,
    });

    function renderWith(data = [weight, height]) {
      hookMocks.usePersonMeasurements.mockReturnValue({ data, isLoading: false, error: null });
      return render(<MeasurementsPage />);
    }

    it("omits hidden measurements from the card view", () => {
      hiddenCodesState = new Set(["height"]);
      renderWith();

      expect(screen.getByText("Weight")).toBeInTheDocument();
      expect(screen.queryByText("Height")).not.toBeInTheDocument();
    });

    it("omits hidden measurements from the table view too", async () => {
      hiddenCodesState = new Set(["height"]);
      renderWith();
      const user = userEvent.setup();

      await user.click(screen.getByRole("tab", { name: "measurements.tableView" }));

      expect(screen.getAllByRole("link", { name: "Weight" }).length).toBeGreaterThan(0);
      expect(screen.queryByRole("link", { name: "Height" })).not.toBeInTheDocument();
    });

    it("puts no hide control on the cards themselves", () => {
      renderWith();

      expect(screen.queryByRole("button", { name: "measurements.hide" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "measurements.unhide" })).not.toBeInTheDocument();
    });

    it("opens the visibility dialog from the header control", async () => {
      hiddenCodesState = new Set(["height"]);
      renderWith();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /measurements\.manageVisibility/ }));

      expect(screen.getByText("measurement-visibility-dialog")).toBeInTheDocument();
    });

    it("summarises the hidden count next to the control, and only when non-zero", () => {
      hiddenCodesState = new Set(["height"]);
      const view = renderWith();
      expect(screen.getByText(/measurements\.hiddenSummary/)).toBeInTheDocument();
      view.unmount();

      hiddenCodesState = new Set();
      renderWith();
      expect(screen.queryByText(/measurements\.hiddenSummary/)).not.toBeInTheDocument();
    });

    it("ignores a hidden code with no matching measurement", () => {
      // The catalog row was deleted after being hidden: counting hiddenCodes
      // instead of present measurements would claim something is hidden that
      // could never have appeared in this list.
      hiddenCodesState = new Set(["gone"]);
      renderWith();

      expect(screen.queryByText(/measurements\.hiddenSummary/)).not.toBeInTheDocument();
      expect(screen.getByText("Weight")).toBeInTheDocument();
      expect(screen.getByText("Height")).toBeInTheDocument();
    });

    it("shows the all-hidden state with a way back to the dialog", async () => {
      hiddenCodesState = new Set(["weight", "height"]);
      renderWith();
      const user = userEvent.setup();

      expect(screen.getByText("measurements.allHidden")).toBeInTheDocument();
      expect(screen.queryByText("measurements.noData")).not.toBeInTheDocument();

      await user.click(
        screen.getAllByRole("button", { name: /measurements\.manageVisibility/ })[1],
      );
      expect(screen.getByText("measurement-visibility-dialog")).toBeInTheDocument();
    });

    it("passes every measurement to the dialog, hidden ones included", async () => {
      hiddenCodesState = new Set(["height"]);
      renderWith();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /measurements\.manageVisibility/ }));

      // The dialog is where you unhide, so it must list hidden entries too.
      expect(screen.getByTestId("dialog-codes")).toHaveTextContent("weight,height");
    });
  });
});
