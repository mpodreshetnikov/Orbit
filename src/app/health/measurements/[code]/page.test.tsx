import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementSummary } from "@/types";

const hookMocks = vi.hoisted(() => ({
  useSingleMeasurementHistory: vi.fn(),
  useDeleteMeasurement: vi.fn(),
  useHiddenMeasurements: vi.fn(),
  useUIStore: vi.fn(),
}));

const toggleHidden = vi.fn();
let hiddenCodesState = new Set<string>();

const routerMock = {
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
};

const deleteMutateAsync = vi.fn();
const uiState = { selectedPersonId: "person-1" as string | null };

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("@/hooks", () => ({
  useSingleMeasurementHistory: (...args: unknown[]) =>
    hookMocks.useSingleMeasurementHistory(...args),
  useDeleteMeasurement: (...args: unknown[]) => hookMocks.useDeleteMeasurement(...args),
  useHiddenMeasurements: (...args: unknown[]) => hookMocks.useHiddenMeasurements(...args),
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: typeof uiState) => unknown) => selector(uiState),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => <div>line</div>,
  XAxis: () => <div>x-axis</div>,
  YAxis: () => <div>y-axis</div>,
  CartesianGrid: () => <div>grid</div>,
  Tooltip: () => <div>tooltip</div>,
}));

vi.mock("@/components/measurements/add-measurement-dialog", () => ({
  AddMeasurementDialog: ({ open }: { open: boolean }) =>
    open ? <div>add-measurement-dialog</div> : null,
}));

vi.mock("@/components/measurements/edit-measurement-dialog", () => ({
  EditMeasurementDialog: ({ open }: { open: boolean }) =>
    open ? <div>edit-measurement-dialog</div> : null,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void | Promise<void>;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={() => void onClick?.()}>
      {children}
    </button>
  ),
}));

function resolvedParams(code: string): Promise<{ code: string }> {
  return {
    status: "fulfilled",
    value: { code },
    then: (resolve: (value: { code: string }) => void) => resolve({ code }),
  } as unknown as Promise<{ code: string }>;
}

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
    latest_value: 73,
    latest_date: "2026-02-22T09:00:00.000Z",
    measurement_count: 2,
    history: [
      {
        id: "m-1",
        value: 72,
        measured_at: "2026-02-20T09:00:00.000Z",
        notes: "prev",
        created_at: "2026-02-20T09:00:00.000Z",
      },
      {
        id: "m-2",
        value: 73,
        measured_at: "2026-02-22T09:00:00.000Z",
        notes: "latest",
        created_at: "2026-02-22T09:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("MeasurementDetailPage", () => {
  beforeEach(() => {
    routerMock.back.mockReset();
    deleteMutateAsync.mockReset();
    deleteMutateAsync.mockResolvedValue(undefined);
    uiState.selectedPersonId = "person-1";
    toggleHidden.mockReset();
    hiddenCodesState = new Set<string>();
    hookMocks.useHiddenMeasurements.mockReset();
    hookMocks.useHiddenMeasurements.mockImplementation(() => ({
      hiddenCodes: hiddenCodesState,
      toggleHidden,
      isLoading: false,
      isToggling: false,
    }));

    hookMocks.useSingleMeasurementHistory.mockReturnValue({
      data: measurement(),
      isLoading: false,
      error: null,
    });
    hookMocks.useDeleteMeasurement.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
  });

  it("renders loading, error, and not-found states", async () => {
    hookMocks.useSingleMeasurementHistory.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });
    const Page = (await import("./page")).default;
    const loading = render(<Page params={resolvedParams("weight")} />);
    expect(loading.container.querySelector(".animate-spin")).toBeTruthy();
    loading.unmount();

    hookMocks.useSingleMeasurementHistory.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error("fail"),
    });
    const errorView = render(<Page params={resolvedParams("weight")} />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
    errorView.unmount();

    hookMocks.useSingleMeasurementHistory.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    render(<Page params={resolvedParams("weight")} />);
    expect(screen.getByText("measurements.noData")).toBeInTheDocument();
  });

  it("renders summary/chart/history and executes edit/delete flows", async () => {
    const user = userEvent.setup();
    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("weight")} />);

    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("measurements.chartTitle")).toBeInTheDocument();
    expect(screen.getByText("+1.4%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "measurements.addMeasurement" }));
    expect(screen.getByText("add-measurement-dialog")).toBeInTheDocument();

    const firstDataRow = screen.getAllByRole("row")[1];
    const firstRowButtons = within(firstDataRow).getAllByRole("button");
    await user.click(firstRowButtons[0]);
    expect(screen.getByText("edit-measurement-dialog")).toBeInTheDocument();

    await user.click(firstRowButtons[1]);
    await user.click(screen.getAllByRole("button", { name: "common.delete" }).at(-1)!);
    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith({ id: "m-2", personId: "person-1" });
    });
  });

  it("shows empty-history branch and back navigation", async () => {
    const user = userEvent.setup();
    hookMocks.useSingleMeasurementHistory.mockReturnValue({
      data: measurement({ history: [], measurement_count: 0 }),
      isLoading: false,
      error: null,
    });

    const Page = (await import("./page")).default;
    render(<Page params={resolvedParams("weight")} />);

    expect(screen.getByText("measurements.addFirst")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button")[0]);
    expect(routerMock.back).toHaveBeenCalled();
  });
});
