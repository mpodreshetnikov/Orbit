import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementCatalog } from "@/types";
import { AddMeasurementDialog } from "./add-measurement-dialog";

const hookMocks = vi.hoisted(() => ({
  useMeasurementCatalog: vi.fn(),
  useCreateMeasurement: vi.fn(),
}));

const createMutateAsync = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useMeasurementCatalog: (...args: unknown[]) => hookMocks.useMeasurementCatalog(...args),
  useCreateMeasurement: (...args: unknown[]) => hookMocks.useCreateMeasurement(...args),
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
});
