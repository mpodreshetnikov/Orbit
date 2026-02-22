import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObservationCatalogList } from "./observation-catalog-list";

const hookMocks = vi.hoisted(() => ({
  useObservationCatalog: vi.fn(),
  useDeleteObservation: vi.fn(),
}));

const deleteMutateAsyncMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useObservationCatalog: (...args: unknown[]) => hookMocks.useObservationCatalog(...args),
  useDeleteObservation: (...args: unknown[]) => hookMocks.useDeleteObservation(...args),
}));

vi.mock("./observation-edit-dialog", () => ({
  ObservationEditDialog: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    observation: unknown;
  }) => (open ? <div>observation-edit-dialog</div> : null),
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

describe("ObservationCatalogList", () => {
  beforeEach(() => {
    deleteMutateAsyncMock.mockReset();
    deleteMutateAsyncMock.mockResolvedValue(undefined);

    hookMocks.useDeleteObservation.mockReturnValue({
      mutateAsync: deleteMutateAsyncMock,
      isPending: false,
    });
  });

  it("renders loading and error states", () => {
    hookMocks.useObservationCatalog.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    });

    const { rerender } = render(<ObservationCatalogList />);
    expect(screen.queryByText("catalogs.noObservations")).not.toBeInTheDocument();

    hookMocks.useObservationCatalog.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error("boom"),
    });
    rerender(<ObservationCatalogList />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
  });

  it("supports add/search empty and delete flows", async () => {
    const user = userEvent.setup();

    hookMocks.useObservationCatalog.mockImplementation((search: string) => {
      if (search === "zzz") {
        return { data: [], isLoading: false, error: null };
      }
      return {
        data: [
          {
            id: "obs-1",
            obs_code: "GLU",
            name_ru: "Глюкоза",
            name_en: "Glucose",
            synonyms_ru: ["сахар"],
            synonyms_en: ["blood glucose", "serum glucose", "fasting glucose", "plasma glucose"],
            canonical_unit: "mmol/L",
            accepted_units: { "mmol/L": 1 },
            default_ref_low: 4,
            default_ref_high: 6,
          },
        ],
        isLoading: false,
        error: null,
      };
    });

    const { container } = render(<ObservationCatalogList />);
    expect(screen.getByText("Glucose")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "catalogs.addObservation" }));
    expect(screen.getByText("observation-edit-dialog")).toBeInTheDocument();

    const deleteButton = container.querySelector("button.text-destructive") as HTMLButtonElement;
    await user.click(deleteButton);
    await user.click(screen.getByRole("button", { name: "common.delete" }));
    expect(deleteMutateAsyncMock).toHaveBeenCalledWith("obs-1");

    await user.type(screen.getByPlaceholderText("catalogs.searchObservations"), "zzz");
    await waitFor(() => {
      expect(screen.getByText("common.noResults")).toBeInTheDocument();
    });
  });
});
