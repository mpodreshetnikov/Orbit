import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useSingleObservationHistory: vi.fn(),
  useObservationCatalog: vi.fn(),
}));

const routerMock = {
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

let selectedPersonIdState: string | null = "person-1";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/hooks", () => ({
  useSingleObservationHistory: (...args: unknown[]) =>
    hookMocks.useSingleObservationHistory(...args),
  useObservationCatalog: (...args: unknown[]) => hookMocks.useObservationCatalog(...args),
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => <div>line</div>,
  XAxis: () => <div>x-axis</div>,
  YAxis: () => <div>y-axis</div>,
  CartesianGrid: () => <div>grid</div>,
  Tooltip: () => <div>tooltip</div>,
  ReferenceLine: () => <div>ref-line</div>,
  ReferenceArea: () => <div>ref-area</div>,
}));

const observationData = {
  obs_code: "glucose",
  obs_name: "Glucose",
  catalog_id: "catalog-1",
  catalog_name_ru: "Глюкоза",
  catalog_name_en: "Glucose",
  canonical_unit: "mmol/L",
  latest_value: 6.2,
  latest_value_text: null,
  latest_unit: "mmol/L",
  latest_status: "high",
  latest_date: "2026-02-20",
  latest_ref_low: 4,
  latest_ref_high: 5.5,
  latest_ref_low_canonical: 4,
  latest_ref_high_canonical: 5.5,
  default_ref_low: 4,
  default_ref_high: 5.5,
  measurement_count: 2,
  history: [
    {
      id: "obs-row-1",
      record_id: "record-1",
      record_date: "2026-02-10",
      value_numeric: 5.4,
      value_text: null,
      value_canonical: 5.4,
      unit: "mmol/L",
      unit_canonical: "mmol/L",
      ref_range_low: 4,
      ref_range_high: 5.5,
      ref_range_low_canonical: 4,
      ref_range_high_canonical: 5.5,
      status: "normal",
      created_at: "2026-02-10T10:00:00.000Z",
    },
    {
      id: "obs-row-2",
      record_id: "record-2",
      record_date: "2026-02-20",
      value_numeric: 6.2,
      value_text: null,
      value_canonical: 6.2,
      unit: "mmol/L",
      unit_canonical: "mmol/L",
      ref_range_low: 4,
      ref_range_high: 5.5,
      ref_range_low_canonical: 4,
      ref_range_high_canonical: 5.5,
      status: "high",
      created_at: "2026-02-20T10:00:00.000Z",
    },
  ],
};

function resolvedParams(obsCode: string): Promise<{ obsCode: string }> {
  return {
    status: "fulfilled",
    value: { obsCode },
    then: (resolve: (value: { obsCode: string }) => void) => resolve({ obsCode }),
  } as unknown as Promise<{ obsCode: string }>;
}

describe("ObservationDetailPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    selectedPersonIdState = "person-1";
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    routerMock.prefetch.mockReset();
    routerMock.prefetch.mockResolvedValue(undefined);

    if (!HTMLElement.prototype.hasPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
        configurable: true,
        value: () => false,
      });
    }
    if (!HTMLElement.prototype.setPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
        configurable: true,
        value: () => undefined,
      });
    }
    if (!HTMLElement.prototype.releasePointerCapture) {
      Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
        configurable: true,
        value: () => undefined,
      });
    }
  });

  it("renders loading and error states", async () => {
    hookMocks.useObservationCatalog.mockReturnValue({ data: [] });
    hookMocks.useSingleObservationHistory.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });

    const Page = (await import("./page")).default;
    const loadingView = render(
      <React.Suspense fallback={<div>suspense-loading</div>}>
        <Page params={resolvedParams("glucose")} />
      </React.Suspense>,
    );
    await waitFor(() => expect(loadingView.container.querySelector(".animate-spin")).toBeTruthy());
    loadingView.unmount();

    hookMocks.useSingleObservationHistory.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error("boom"),
    });
    const errorView = render(
      <React.Suspense fallback={<div>suspense-loading</div>}>
        <Page params={resolvedParams("glucose")} />
      </React.Suspense>,
    );
    expect(await screen.findByText("common.error")).toBeInTheDocument();
    errorView.unmount();
  }, 20000);

  it("renders not-found state when observation data is empty", async () => {
    hookMocks.useObservationCatalog.mockReturnValue({ data: [] });
    hookMocks.useSingleObservationHistory.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    const Page = (await import("./page")).default;
    render(
      <React.Suspense fallback={<div>suspense-loading</div>}>
        <Page params={resolvedParams("glucose")} />
      </React.Suspense>,
    );

    expect((await screen.findAllByText("observationHistory.noData")).length).toBeGreaterThan(0);
  });

  it("renders summary/table content and handles back navigation", async () => {
    hookMocks.useObservationCatalog.mockReturnValue({
      data: [
        {
          id: "catalog-1",
          accepted_units: {
            "mmol/L": { factor_to_canonical: 1 },
            "mg/dL": { factor_to_canonical: 18 },
          },
        },
      ],
    });
    hookMocks.useSingleObservationHistory.mockReturnValue({
      data: observationData,
      isLoading: false,
      error: null,
    });

    const Page = (await import("./page")).default;
    render(
      <React.Suspense fallback={<div>suspense-loading</div>}>
        <Page params={resolvedParams("glucose")} />
      </React.Suspense>,
    );

    expect(await screen.findByText("Глюкоза")).toBeInTheDocument();
    expect(screen.getByText("glucose")).toBeInTheDocument();
    expect(screen.getAllByText("observations.status.high").length).toBeGreaterThan(0);
    expect(screen.getByText("observationHistory.outOfRange")).toBeInTheDocument();
    expect(screen.getByText("observationHistory.chartTitle")).toBeInTheDocument();
    expect(screen.getByText("observationHistory.historyTitle")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button")[0]);
    expect(routerMock.back).toHaveBeenCalledTimes(1);
  });

  it("switches display unit and updates converted values and trend", async () => {
    hookMocks.useObservationCatalog.mockReturnValue({
      data: [
        {
          id: "catalog-1",
          accepted_units: {
            "mmol/L": { factor_to_canonical: 1 },
            "mg/dL": { factor_to_canonical: 0.0555 },
          },
        },
      ],
    });
    hookMocks.useSingleObservationHistory.mockReturnValue({
      data: {
        ...observationData,
        catalog_name_ru: "Glucose RU",
      },
      isLoading: false,
      error: null,
    });

    const Page = (await import("./page")).default;
    render(
      <React.Suspense fallback={<div>suspense-loading</div>}>
        <Page params={resolvedParams("glucose")} />
      </React.Suspense>,
    );

    expect(await screen.findByText("Glucose RU")).toBeInTheDocument();
    expect(screen.getByText("+14.8%")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "mg/dL" }));

    await waitFor(() => {
      expect(screen.getByText("111.7")).toBeInTheDocument();
      expect(
        screen.getAllByText((_, node) => {
          const text = node?.textContent ?? "";
          return text.includes("72.1") && text.includes("99.1");
        }).length,
      ).toBeGreaterThan(0);
    });
  });

  it("renders stable trend and text fallback values", async () => {
    hookMocks.useObservationCatalog.mockReturnValue({
      data: [
        {
          id: "catalog-2",
          accepted_units: {
            "mmol/L": { factor_to_canonical: 1 },
          },
        },
      ],
    });
    hookMocks.useSingleObservationHistory.mockReturnValue({
      data: {
        ...observationData,
        catalog_id: "catalog-2",
        catalog_name_ru: "Text-only",
        latest_value: null,
        latest_value_text: "trace",
        latest_status: "unknown",
        latest_ref_low: null,
        latest_ref_high: null,
        latest_ref_low_canonical: null,
        latest_ref_high_canonical: null,
        default_ref_low: null,
        default_ref_high: null,
        history: [
          {
            ...observationData.history[0],
            id: "obs-text-1",
            record_date: null,
            value_numeric: null,
            value_canonical: null,
            value_text: "trace",
            ref_range_low: null,
            ref_range_high: null,
            ref_range_low_canonical: null,
            ref_range_high_canonical: null,
            status: "unknown",
          },
          {
            ...observationData.history[1],
            id: "obs-text-2",
            value_numeric: 6.0,
            value_canonical: 6.0,
            status: "normal",
          },
          {
            ...observationData.history[1],
            id: "obs-text-3",
            value_numeric: 6.03,
            value_canonical: 6.03,
            status: "normal",
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    const Page = (await import("./page")).default;
    render(
      <React.Suspense fallback={<div>suspense-loading</div>}>
        <Page params={resolvedParams("glucose")} />
      </React.Suspense>,
    );

    expect(await screen.findByText("Text-only")).toBeInTheDocument();
    expect(screen.getByText("observationHistory.stable")).toBeInTheDocument();
    expect(screen.getAllByText("trace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders empty chart when numeric history is missing", async () => {
    hookMocks.useObservationCatalog.mockReturnValue({
      data: [{ id: "catalog-3", accepted_units: { "mmol/L": { factor_to_canonical: 1 } } }],
    });
    hookMocks.useSingleObservationHistory.mockReturnValue({
      data: {
        ...observationData,
        catalog_id: "catalog-3",
        catalog_name_ru: "No numeric chart",
        latest_value: null,
        latest_value_text: "trace",
        history: [
          {
            ...observationData.history[0],
            id: "text-only-1",
            value_numeric: null,
            value_canonical: null,
            value_text: "trace",
          },
          {
            ...observationData.history[1],
            id: "text-only-2",
            value_numeric: null,
            value_canonical: null,
            value_text: "trace",
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    const Page = (await import("./page")).default;
    render(
      <React.Suspense fallback={<div>suspense-loading</div>}>
        <Page params={resolvedParams("glucose")} />
      </React.Suspense>,
    );

    expect(await screen.findByText("No numeric chart")).toBeInTheDocument();
    expect(screen.getByText("No data to display")).toBeInTheDocument();
  });
});
