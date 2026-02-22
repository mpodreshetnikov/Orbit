import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservationSummary } from "@/types";
import ObservationsHistoryPage from "./page";

const hookMocks = vi.hoisted(() => ({
  usePersonObservationHistory: vi.fn(),
}));

let selectedPersonIdState: string | null = "person-1";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  usePersonObservationHistory: (...args: unknown[]) =>
    hookMocks.usePersonObservationHistory(...args),
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

function makeObservation(overrides: Partial<ObservationSummary> = {}): ObservationSummary {
  return {
    obs_code: "glucose",
    obs_name: "Glucose",
    catalog_id: "cat-1",
    catalog_name_ru: null,
    catalog_name_en: "Glucose",
    canonical_unit: "mmol/L",
    latest_value: 5.4,
    latest_value_text: null,
    latest_unit: "mmol/L",
    latest_status: "normal",
    latest_date: "2026-01-02",
    latest_ref_low: 4,
    latest_ref_high: 6,
    latest_ref_low_canonical: 4,
    latest_ref_high_canonical: 6,
    default_ref_low: 4,
    default_ref_high: 6,
    measurement_count: 2,
    history: [
      {
        id: "obs-1",
        record_id: "record-1",
        record_date: "2026-01-01",
        value_numeric: 5.1,
        value_text: null,
        value_canonical: 5.1,
        unit: "mmol/L",
        unit_canonical: "mmol/L",
        ref_range_low: 4,
        ref_range_high: 6,
        ref_range_low_canonical: 4,
        ref_range_high_canonical: 6,
        status: "normal",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "obs-2",
        record_id: "record-2",
        record_date: "2026-01-02",
        value_numeric: 5.4,
        value_text: null,
        value_canonical: 5.4,
        unit: "mmol/L",
        unit_canonical: "mmol/L",
        ref_range_low: 4,
        ref_range_high: 6,
        ref_range_low_canonical: 4,
        ref_range_high_canonical: 6,
        status: "normal",
        created_at: "2026-01-02T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("ObservationsHistoryPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
  });

  it("renders person prompt when no person is selected", () => {
    selectedPersonIdState = null;
    hookMocks.usePersonObservationHistory.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<ObservationsHistoryPage />);
    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("renders loading and error states", () => {
    hookMocks.usePersonObservationHistory.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    });
    const view = render(<ObservationsHistoryPage />);
    expect(screen.getByText("observationHistory.title")).toBeInTheDocument();
    view.unmount();

    hookMocks.usePersonObservationHistory.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error("boom"),
    });
    render(<ObservationsHistoryPage />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
  });

  it("shows empty state and search-empty state", async () => {
    hookMocks.usePersonObservationHistory.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<ObservationsHistoryPage />);
    const user = userEvent.setup();

    expect(screen.getByText("observationHistory.noData")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("observationHistory.searchPlaceholder"), "glu");
    expect(screen.getByText("observationHistory.noSearchResults")).toBeInTheDocument();
  });

  it("renders cards and switches to table view", async () => {
    hookMocks.usePersonObservationHistory.mockReturnValue({
      data: [makeObservation()],
      isLoading: false,
      error: null,
    });

    render(<ObservationsHistoryPage />);
    const user = userEvent.setup();

    expect(screen.getByText("Glucose")).toBeInTheDocument();
    expect(screen.getAllByText(/observationHistory\.measurements/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: "observationHistory.tableView" }));
    expect(screen.getByText("observationHistory.value")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Glucose" }).length).toBeGreaterThan(0);
  });

  it("renders trend icons and value/unit/status fallbacks in cards", () => {
    const stable = makeObservation({
      obs_code: "stable",
      obs_name: "Stable",
      latest_status: "normal",
      history: [
        {
          ...makeObservation().history[0],
          id: "stable-1",
          value_canonical: 10,
          value_numeric: 10,
        },
        {
          ...makeObservation().history[1],
          id: "stable-2",
          value_canonical: 10.05,
          value_numeric: 10.05,
        },
      ],
    });
    const rising = makeObservation({
      obs_code: "rising",
      obs_name: "Rising",
      latest_status: "high",
      history: [
        {
          ...makeObservation().history[0],
          id: "rising-1",
          value_canonical: 5,
          value_numeric: 5,
        },
        {
          ...makeObservation().history[1],
          id: "rising-2",
          value_canonical: 7,
          value_numeric: 7,
        },
      ],
    });
    const fallingWithText = makeObservation({
      obs_code: "FALL",
      obs_name: "Falling",
      latest_value: null,
      latest_value_text: "trace",
      latest_unit: null,
      canonical_unit: "mg/dL",
      latest_status: "low",
      history: [
        {
          ...makeObservation().history[0],
          id: "fall-1",
          value_canonical: null,
          value_numeric: 9,
        },
        {
          ...makeObservation().history[1],
          id: "fall-2",
          value_canonical: null,
          value_numeric: 7,
        },
      ],
    });
    hookMocks.usePersonObservationHistory.mockReturnValue({
      data: [stable, rising, fallingWithText],
      isLoading: false,
      error: null,
    });

    const view = render(<ObservationsHistoryPage />);
    expect(screen.getByText("trace")).toBeInTheDocument();
    expect(screen.getByText("mg/dL")).toBeInTheDocument();
    expect(screen.getByText("observations.status.low")).toBeInTheDocument();
    expect(view.container.querySelector(".lucide-minus")).toBeTruthy();
    expect(view.container.querySelector(".lucide-trending-up")).toBeTruthy();
    expect(view.container.querySelector(".lucide-trending-down")).toBeTruthy();
  });

  it("renders table no-data and row fallback values", async () => {
    const noHistory = makeObservation({
      obs_code: "empty",
      obs_name: "Empty",
      history: [],
      measurement_count: 0,
    });
    hookMocks.usePersonObservationHistory.mockReturnValue({
      data: [noHistory],
      isLoading: false,
      error: null,
    });
    render(<ObservationsHistoryPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "observationHistory.tableView" }));
    expect(screen.getByText("observationHistory.noData")).toBeInTheDocument();

    const fallbackRow = makeObservation({
      obs_code: "txt",
      obs_name: "Text Only",
      latest_value: null,
      latest_value_text: "pending",
      latest_unit: null,
      canonical_unit: null,
      history: [
        {
          ...makeObservation().history[0],
          id: "txt-row",
          value_canonical: null,
          value_numeric: null,
          value_text: "pending",
          unit_canonical: null,
          unit: null,
          ref_range_low: null,
          ref_range_high: null,
          record_date: null,
          created_at: "2026-01-01T00:00:00.000Z",
          status: "unknown",
        },
      ],
    });
    hookMocks.usePersonObservationHistory.mockReturnValue({
      data: [fallbackRow],
      isLoading: false,
      error: null,
    });
    render(<ObservationsHistoryPage />);
    await user.click(screen.getAllByRole("tab", { name: "observationHistory.tableView" })[1]);
    expect(screen.getAllByText("pending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
