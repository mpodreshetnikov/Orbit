import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BodySiteCatalogList } from "./body-site-catalog-list";

const hookMocks = vi.hoisted(() => ({
  useBodySiteCatalog: vi.fn(),
  useDeleteBodySite: vi.fn(),
}));

const deleteMutateAsyncMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks", () => ({
  useBodySiteCatalog: (...args: unknown[]) => hookMocks.useBodySiteCatalog(...args),
  useDeleteBodySite: (...args: unknown[]) => hookMocks.useDeleteBodySite(...args),
}));

vi.mock("./body-site-edit-dialog", () => ({
  BodySiteEditDialog: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    bodySite: unknown;
    allSites: unknown[];
  }) => (open ? <div>body-site-edit-dialog</div> : null),
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

describe("BodySiteCatalogList", () => {
  beforeEach(() => {
    deleteMutateAsyncMock.mockReset();
    deleteMutateAsyncMock.mockResolvedValue(undefined);
    hookMocks.useDeleteBodySite.mockReturnValue({
      mutateAsync: deleteMutateAsyncMock,
      isPending: false,
    });
  });

  it("renders loading and error branches", () => {
    hookMocks.useBodySiteCatalog.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    });
    const { rerender } = render(<BodySiteCatalogList />);
    expect(screen.queryByText("catalogs.noItems")).not.toBeInTheDocument();

    hookMocks.useBodySiteCatalog.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error("broken"),
    });
    rerender(<BodySiteCatalogList />);
    expect(screen.getByText("common.error")).toBeInTheDocument();
  });

  it("supports add/search and delete confirmation flow", async () => {
    const user = userEvent.setup();

    hookMocks.useBodySiteCatalog.mockReturnValue({
      data: [
        {
          id: "site-1",
          site_code: "head",
          name_ru: "Голова",
          name_en: "Head",
          parent_site_code: null,
          synonyms_ru: ["череп"],
          synonyms_en: ["head"],
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
      error: null,
    });

    const { container } = render(<BodySiteCatalogList />);
    expect(screen.getByText("Голова")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "catalogs.add" }));
    expect(screen.getByText("body-site-edit-dialog")).toBeInTheDocument();

    const deleteButton = container.querySelector("button.text-destructive") as HTMLButtonElement;
    await user.click(deleteButton);
    await user.click(screen.getByRole("button", { name: "common.delete" }));
    expect(deleteMutateAsyncMock).toHaveBeenCalledWith("site-1");

    await user.type(screen.getByPlaceholderText("catalogs.searchPlaceholder"), "zzz");
    await waitFor(() => {
      expect(screen.getByText("catalogs.noSearchResults")).toBeInTheDocument();
    });
  });
});
