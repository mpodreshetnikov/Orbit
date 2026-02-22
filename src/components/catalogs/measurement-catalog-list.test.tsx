import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeasurementCatalogList } from "./measurement-catalog-list";

const hookMocks = vi.hoisted(() => ({
  useMeasurementCatalog: vi.fn(),
  useDeleteMeasurementCatalogItem: vi.fn(),
}));

const deleteMutateAsyncMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useMeasurementCatalog: (...args: unknown[]) => hookMocks.useMeasurementCatalog(...args),
  useDeleteMeasurementCatalogItem: (...args: unknown[]) =>
    hookMocks.useDeleteMeasurementCatalogItem(...args),
}));

vi.mock("./measurement-catalog-edit-dialog", () => ({
  MeasurementCatalogEditDialog: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    measurement: unknown;
  }) => (open ? <div>measurement-edit-dialog</div> : null),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => <div>{open ? children : null}</div>,
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
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

describe("MeasurementCatalogList", () => {
  beforeEach(() => {
    deleteMutateAsyncMock.mockReset();
    deleteMutateAsyncMock.mockResolvedValue(undefined);

    hookMocks.useDeleteMeasurementCatalogItem.mockReturnValue({
      mutateAsync: deleteMutateAsyncMock,
      isPending: false,
    });
  });

  it("renders loading and error branches", () => {
    hookMocks.useMeasurementCatalog.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    });
    const { rerender } = render(<MeasurementCatalogList />);
    expect(screen.queryByText("catalogs.noMeasurements")).not.toBeInTheDocument();

    hookMocks.useMeasurementCatalog.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error("broken"),
    });
    rerender(<MeasurementCatalogList />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
  });

  it("supports add/search/empty and delete flows", async () => {
    const user = userEvent.setup();
    document.documentElement.lang = "en";

    hookMocks.useMeasurementCatalog.mockImplementation((search: string) => {
      if (search === "zzz") {
        return { data: [], isLoading: false, error: null };
      }
      return {
        data: [
          {
            id: "m-1",
            code: "weight",
            name_ru: "Вес",
            name_en: "Weight",
            unit_ru: "кг",
            unit_en: "kg",
            category: "basic",
            sort_order: 0,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        isLoading: false,
        error: null,
      };
    });

    const { container } = render(<MeasurementCatalogList />);
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Basic")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "catalogs.addMeasurement" }));
    expect(screen.getByText("measurement-edit-dialog")).toBeInTheDocument();

    const deleteButton = container.querySelector("button.text-destructive") as HTMLButtonElement;
    await user.click(deleteButton);
    await user.click(screen.getByRole("button", { name: "common.delete" }));
    expect(deleteMutateAsyncMock).toHaveBeenCalledWith("m-1");

    await user.type(screen.getByPlaceholderText("catalogs.searchMeasurements"), "zzz");
    await waitFor(() => {
      expect(screen.getByText("common.noResults")).toBeInTheDocument();
    });
  });
});
