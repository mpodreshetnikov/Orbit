import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FindingTypeCatalogList } from "./finding-type-catalog-list";

const hookMocks = vi.hoisted(() => ({
  useFindingTypeCatalog: vi.fn(),
  useDeleteFindingType: vi.fn(),
}));

const deleteMutateAsyncMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useFindingTypeCatalog: (...args: unknown[]) => hookMocks.useFindingTypeCatalog(...args),
  useDeleteFindingType: (...args: unknown[]) => hookMocks.useDeleteFindingType(...args),
}));

vi.mock("./finding-type-edit-dialog", () => ({
  FindingTypeEditDialog: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    findingType: unknown;
  }) => (open ? <div>finding-type-edit-dialog</div> : null),
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

describe("FindingTypeCatalogList", () => {
  beforeEach(() => {
    deleteMutateAsyncMock.mockReset();
    deleteMutateAsyncMock.mockResolvedValue(undefined);
    hookMocks.useDeleteFindingType.mockReturnValue({
      mutateAsync: deleteMutateAsyncMock,
      isPending: false,
    });
  });

  it("renders loading and error branches", () => {
    hookMocks.useFindingTypeCatalog.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    });
    const { rerender } = render(<FindingTypeCatalogList />);
    expect(screen.queryByText("catalogs.noItems")).not.toBeInTheDocument();

    hookMocks.useFindingTypeCatalog.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error("broken"),
    });
    rerender(<FindingTypeCatalogList />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
  });

  it("supports add/search and delete confirmation flow", async () => {
    const user = userEvent.setup();

    hookMocks.useFindingTypeCatalog.mockReturnValue({
      data: [
        {
          id: "finding-1",
          finding_code: "nodule",
          name_ru: "Узел",
          name_en: "Nodule",
          synonyms_ru: ["узелок"],
          synonyms_en: ["nodule"],
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
      error: null,
    });

    const { container } = render(<FindingTypeCatalogList />);
    expect(screen.getByText("Узел")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "catalogs.add" }));
    expect(screen.getByText("finding-type-edit-dialog")).toBeInTheDocument();

    const deleteButton = container.querySelector("button.text-destructive") as HTMLButtonElement;
    await user.click(deleteButton);
    await user.click(screen.getByRole("button", { name: "common.delete" }));
    expect(deleteMutateAsyncMock).toHaveBeenCalledWith("finding-1");

    await user.type(screen.getByPlaceholderText("catalogs.searchPlaceholder"), "zzz");
    await waitFor(() => {
      expect(screen.getByText("catalogs.noSearchResults")).toBeInTheDocument();
    });
  });
});
