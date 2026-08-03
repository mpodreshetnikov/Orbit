import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementCatalog } from "@/types";
import { AddMeasurementDialog } from "./add-measurement-dialog";

const hookMocks = vi.hoisted(() => ({
  useMeasurementCatalog: vi.fn(),
  useCreateMeasurement: vi.fn(),
  useSingleMeasurementHistory: vi.fn(),
}));

const createMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useMeasurementCatalog: (...args: unknown[]) => hookMocks.useMeasurementCatalog(...args),
  useCreateMeasurement: (...args: unknown[]) => hookMocks.useCreateMeasurement(...args),
  useSingleMeasurementHistory: (...args: unknown[]) =>
    hookMocks.useSingleMeasurementHistory(...args),
}));

vi.mock("@/lib/date-locale", () => ({
  useDateFnsLocale: () => undefined,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder ?? "command-input"}
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
    value,
    className,
  }: {
    children: React.ReactNode;
    onSelect?: (value: string) => void;
    value?: string;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={() => onSelect?.(value ?? "")}>
      {children}
    </button>
  ),
}));

function catalogItem(overrides: Partial<MeasurementCatalog> = {}): MeasurementCatalog {
  return {
    id: "cat-1",
    code: "weight",
    name_ru: "Вес",
    name_en: "Weight",
    unit_ru: "кг",
    unit_en: "kg",
    category: "basic",
    sort_order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AddMeasurementDialog", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    createMutateAsync.mockReset();
    createMutateAsync.mockResolvedValue(undefined);
    hookMocks.useMeasurementCatalog.mockReturnValue({
      data: [catalogItem(), catalogItem({ id: "cat-2", code: "bp", name_en: "Blood pressure" })],
      isLoading: false,
    });
    hookMocks.useCreateMeasurement.mockReturnValue({
      mutateAsync: createMutateAsync,
      isPending: false,
    });
    hookMocks.useSingleMeasurementHistory.mockReset();
    hookMocks.useSingleMeasurementHistory.mockReturnValue({ data: null, isLoading: false });
  });

  it("creates measurement for selected catalog entry", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<AddMeasurementDialog open onOpenChange={onOpenChange} personId="person-1" />);

    await user.click(screen.getByRole("button", { name: /Weight/ }));
    fireEvent.change(screen.getByLabelText("measurements.value"), {
      target: { value: "72.5" },
    });
    fireEvent.change(screen.getByLabelText("measurements.measuredAt"), {
      target: { value: "2026-02-22T09:45" },
    });
    fireEvent.change(screen.getByLabelText("measurements.notes"), {
      target: { value: "morning weight" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({
        person_id: "person-1",
        catalog_id: "cat-1",
        value: 72.5,
        measured_at: new Date("2026-02-22T09:45").toISOString(),
        notes: "morning weight",
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("respects preselected code and blocks submit when person is missing", async () => {
    const user = userEvent.setup();
    render(
      <AddMeasurementDialog open onOpenChange={vi.fn()} personId={null} preselectedCode="weight" />,
    );

    expect(screen.getByRole("combobox")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("measurements.value"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("measurements.measuredAt"), {
      target: { value: "2026-02-22T10:00" },
    });

    await user.click(screen.getByRole("button", { name: "common.save" }));
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  describe("last recorded hint", () => {
    function historyFor(latest_value: number, measurement_count = 3) {
      return {
        data: {
          code: "weight",
          catalog_id: "cat-1",
          name_ru: "Вес",
          name_en: "Weight",
          unit_ru: "кг",
          unit_en: "kg",
          category: "basic" as const,
          sort_order: 1,
          latest_value,
          latest_date: "2026-02-22T09:00:00.000Z",
          measurement_count,
          history: [],
        },
        isLoading: false,
      };
    }

    it("shows nothing until a type is selected", () => {
      hookMocks.useSingleMeasurementHistory.mockReturnValue(historyFor(72.5));
      render(<AddMeasurementDialog open onOpenChange={vi.fn()} personId="person-1" />);

      expect(screen.queryByText(/measurements\.lastRecorded/)).not.toBeInTheDocument();
      expect(screen.queryByText("measurements.noPreviousValue")).not.toBeInTheDocument();
    });

    it("shows the last recorded value and date once a type is selected", async () => {
      hookMocks.useSingleMeasurementHistory.mockReturnValue(historyFor(72.5));
      const user = userEvent.setup();
      render(<AddMeasurementDialog open onOpenChange={vi.fn()} personId="person-1" />);

      await user.click(screen.getByRole("button", { name: /Weight/ }));

      expect(screen.getByText(/measurements\.lastRecorded/)).toBeInTheDocument();
      expect(screen.getByText(/72\.5 kg/)).toBeInTheDocument();
      expect(screen.getByText(/22 Feb 2026/)).toBeInTheDocument();
    });

    it("renders whole numbers without a decimal", async () => {
      hookMocks.useSingleMeasurementHistory.mockReturnValue(historyFor(70));
      const user = userEvent.setup();
      render(<AddMeasurementDialog open onOpenChange={vi.fn()} personId="person-1" />);

      await user.click(screen.getByRole("button", { name: /Weight/ }));

      expect(screen.getByText(/70 kg/)).toBeInTheDocument();
      expect(screen.queryByText(/70\.0 kg/)).not.toBeInTheDocument();
    });

    it("falls back to an empty-state line when nothing was ever recorded", async () => {
      hookMocks.useSingleMeasurementHistory.mockReturnValue(historyFor(0, 0));
      const user = userEvent.setup();
      render(<AddMeasurementDialog open onOpenChange={vi.fn()} personId="person-1" />);

      await user.click(screen.getByRole("button", { name: /Weight/ }));

      expect(screen.getByText("measurements.noPreviousValue")).toBeInTheDocument();
    });

    it("never prefills the value input", async () => {
      hookMocks.useSingleMeasurementHistory.mockReturnValue(historyFor(72.5));
      const user = userEvent.setup();
      render(<AddMeasurementDialog open onOpenChange={vi.fn()} personId="person-1" />);

      await user.click(screen.getByRole("button", { name: /Weight/ }));

      expect(screen.getByText(/72\.5 kg/)).toBeInTheDocument();
      expect(screen.getByLabelText("measurements.value")).toHaveValue(null);
    });

    it("does not query while the dialog is closed", () => {
      render(
        <AddMeasurementDialog
          open={false}
          onOpenChange={vi.fn()}
          personId="person-1"
          preselectedCode="weight"
        />,
      );

      expect(hookMocks.useSingleMeasurementHistory).toHaveBeenCalledWith(null, null);
    });

    it("still lists every catalog entry in the dropdown", () => {
      hookMocks.useSingleMeasurementHistory.mockReturnValue(historyFor(72.5));
      render(<AddMeasurementDialog open onOpenChange={vi.fn()} personId="person-1" />);

      expect(screen.getByRole("button", { name: /Weight/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Blood pressure/ })).toBeInTheDocument();
    });
  });
});
