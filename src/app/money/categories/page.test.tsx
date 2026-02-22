import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyCategory } from "@/types";
import MoneyCategoriesPage from "./page";

const hookMocks = vi.hoisted(() => ({
  useMoneyCategories: vi.fn(),
  useCreateMoneyCategory: vi.fn(),
  useUpdateMoneyCategory: vi.fn(),
  useDeleteMoneyCategory: vi.fn(),
  buildMoneyCategoryTree: vi.fn(),
  flattenMoneyCategoryTree: vi.fn(),
}));

let searchParamsState = new URLSearchParams();

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsState,
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@/hooks", () => ({
  useMoneyCategories: (...args: unknown[]) => hookMocks.useMoneyCategories(...args),
  useCreateMoneyCategory: (...args: unknown[]) => hookMocks.useCreateMoneyCategory(...args),
  useUpdateMoneyCategory: (...args: unknown[]) => hookMocks.useUpdateMoneyCategory(...args),
  useDeleteMoneyCategory: (...args: unknown[]) => hookMocks.useDeleteMoneyCategory(...args),
  buildMoneyCategoryTree: (...args: unknown[]) => hookMocks.buildMoneyCategoryTree(...args),
  flattenMoneyCategoryTree: (...args: unknown[]) => hookMocks.flattenMoneyCategoryTree(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="dialog-root" data-open={open ? "true" : "false"}>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        close-dialog
      </button>
      {open ? children : null}
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="alert-root" data-open={open ? "true" : "false"}>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        close-alert
      </button>
      {open ? children : null}
    </div>
  ),
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

vi.mock("@/components/tree-view", () => ({
  TreeView: ({
    data,
    renderItem,
  }: {
    data: Array<{ id: string; name: string; children?: Array<{ id: string; name: string }> }>;
    renderItem?: (params: {
      item: { id: string; name: string; children?: Array<{ id: string; name: string }> };
      level: number;
      isLeaf: boolean;
      isSelected: boolean;
      hasChildren: boolean;
    }) => React.ReactNode;
  }) => (
    <div>
      {data.map((item) => (
        <div key={item.id}>
          {renderItem
            ? renderItem({
                item,
                level: 0,
                isLeaf: !item.children?.length,
                isSelected: false,
                hasChildren: !!item.children?.length,
              })
            : item.name}
          {item.children?.map((child) => (
            <div key={child.id}>
              {renderItem
                ? renderItem({
                    item: child,
                    level: 1,
                    isLeaf: true,
                    isSelected: false,
                    hasChildren: false,
                  })
                : child.name}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

function makeCategory(overrides: Partial<MoneyCategory> = {}): MoneyCategory {
  return {
    id: "cat-1",
    parent_id: null,
    depth: 1,
    name_ru: "Продукты",
    name_en: "Groceries",
    slug: "groceries",
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildTree(categories: MoneyCategory[]) {
  const byParent = new Map<string | null, MoneyCategory[]>();
  categories.forEach((category) => {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category);
    byParent.set(category.parent_id, list);
  });
  type TreeNode = {
    id: string;
    parent_id: string | null;
    depth: number;
    name_en: string;
    name_ru: string;
    slug: string;
    children: TreeNode[];
  };
  const mapNode = (category: MoneyCategory): TreeNode => ({
    id: category.id,
    parent_id: category.parent_id,
    depth: category.depth,
    name_en: category.name_en,
    name_ru: category.name_ru,
    slug: category.slug,
    children: (byParent.get(category.id) ?? []).map((c) => mapNode(c)),
  });
  return (byParent.get(null) ?? []).map(mapNode);
}

function flattenTree(
  nodes: Array<{
    id: string;
    depth: number;
    name_en: string;
    children: Array<{ id: string; depth: number; name_en: string; children: unknown[] }>;
  }>,
) {
  const result: Array<{ id: string; depth: number; name_en: string }> = [];
  const visit = (node: { id: string; depth: number; name_en: string; children: unknown[] }) => {
    result.push({ id: node.id, depth: node.depth, name_en: node.name_en });
    node.children.forEach((child) =>
      visit(child as { id: string; depth: number; name_en: string; children: unknown[] }),
    );
  };
  nodes.forEach(visit);
  return result;
}

function setupCategoriesData(categories: MoneyCategory[]) {
  hookMocks.useMoneyCategories.mockReturnValue({
    data: categories,
    isLoading: false,
  });
  hookMocks.buildMoneyCategoryTree.mockImplementation(buildTree);
  hookMocks.flattenMoneyCategoryTree.mockImplementation(flattenTree);
}

describe("MoneyCategoriesPage", () => {
  beforeEach(() => {
    searchParamsState = new URLSearchParams();
    toastMock.error.mockReset();

    createMutateAsync.mockReset();
    updateMutateAsync.mockReset();
    deleteMutateAsync.mockReset();

    createMutateAsync.mockResolvedValue(undefined);
    updateMutateAsync.mockResolvedValue(undefined);
    deleteMutateAsync.mockResolvedValue(undefined);

    hookMocks.useCreateMoneyCategory.mockReturnValue({
      mutateAsync: createMutateAsync,
      isPending: false,
    });
    hookMocks.useUpdateMoneyCategory.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
    hookMocks.useDeleteMoneyCategory.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
  });

  it("renders loading skeletons", () => {
    hookMocks.useMoneyCategories.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    hookMocks.buildMoneyCategoryTree.mockReturnValue([]);
    hookMocks.flattenMoneyCategoryTree.mockReturnValue([]);

    const view = render(<MoneyCategoriesPage />);
    expect(view.container.querySelectorAll(".animate-pulse").length).toBe(3);
  });

  it("auto-opens create dialog when search param new=1", () => {
    searchParamsState = new URLSearchParams("new=1");
    setupCategoriesData([]);

    render(<MoneyCategoriesPage />);
    const openDialog = screen
      .getAllByTestId("dialog-root")
      .find((el) => el.getAttribute("data-open") === "true");
    expect(openDialog).toBeTruthy();
    expect(screen.getByRole("heading", { name: "money.addCategory" })).toBeInTheDocument();
  });

  it("shows validation error when required fields are empty", async () => {
    setupCategoriesData([]);
    render(<MoneyCategoriesPage />);
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: "money.addCategory" })[0]);
    await user.click(screen.getAllByRole("button", { name: "common.save" })[0]);

    expect(toastMock.error).toHaveBeenCalledWith("money.validationCategoryRequired");
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("creates a root category from dialog input", async () => {
    setupCategoriesData([]);
    render(<MoneyCategoriesPage />);
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: "money.addCategory" })[0]);
    const textboxes = screen.getAllByRole("textbox");
    await user.type(textboxes[0], "Transport");
    await user.type(textboxes[1], "Транспорт");
    await user.type(textboxes[2], "transport");
    await user.click(screen.getAllByRole("button", { name: "common.save" })[0]);

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({
        parent_id: null,
        depth: 1,
        name_en: "Transport",
        name_ru: "Транспорт",
        slug: "transport",
      });
    });
  });

  it("creates a child category from tree action with incremented depth", async () => {
    const root = makeCategory({
      id: "root",
      depth: 1,
      name_en: "Root",
      name_ru: "Root",
      slug: "root",
    });
    setupCategoriesData([root]);
    render(<MoneyCategoriesPage />);
    const user = userEvent.setup();

    const addButtons = screen.getAllByRole("button", { name: "money.addCategory" });
    await user.click(addButtons[1]);

    const textboxes = screen.getAllByRole("textbox");
    await user.type(textboxes[0], "Child");
    await user.type(textboxes[1], "Child RU");
    await user.type(textboxes[2], "child");
    await user.click(screen.getAllByRole("button", { name: "common.save" })[0]);

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({
        parent_id: "root",
        depth: 2,
        name_en: "Child",
        name_ru: "Child RU",
        slug: "child",
      });
    });
  });

  it("updates an existing category via edit action", async () => {
    const root = makeCategory({
      id: "root",
      depth: 1,
      name_en: "Root",
      name_ru: "Root",
      slug: "root",
    });
    setupCategoriesData([root]);
    render(<MoneyCategoriesPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "common.edit" }));
    expect(screen.getByRole("heading", { name: "money.editCategory" })).toBeInTheDocument();

    const textboxes = screen.getAllByRole("textbox");
    await user.clear(textboxes[0]);
    await user.type(textboxes[0], "Updated Root");
    await user.clear(textboxes[1]);
    await user.type(textboxes[1], "Updated Root RU");
    await user.clear(textboxes[2]);
    await user.type(textboxes[2], "updated-root");
    await user.click(screen.getAllByRole("button", { name: "common.save" })[0]);

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: "root",
        updates: {
          parent_id: null,
          depth: 1,
          name_en: "Updated Root",
          name_ru: "Updated Root RU",
          slug: "updated-root",
        },
      });
    });
  });

  it("renders fallback tree item name when category lookup is missing", () => {
    hookMocks.useMoneyCategories.mockReturnValue({
      data: [makeCategory({ id: "known", name_en: "Known", name_ru: "Known", slug: "known" })],
      isLoading: false,
    });
    hookMocks.buildMoneyCategoryTree.mockReturnValue([
      {
        id: "unknown",
        parent_id: null,
        depth: 1,
        name_en: "Ghost node",
        name_ru: "Ghost node",
        slug: "ghost-node",
        children: [],
      },
    ]);
    hookMocks.flattenMoneyCategoryTree.mockReturnValue([
      {
        id: "unknown",
        depth: 1,
        name_en: "Ghost node",
      },
    ]);

    render(<MoneyCategoriesPage />);
    expect(screen.getByText("Ghost node")).toBeInTheDocument();
  });

  it("blocks deleting a category that has children", async () => {
    const root = makeCategory({ id: "root", name_en: "Root", name_ru: "Корень", slug: "root" });
    const child = makeCategory({
      id: "child",
      parent_id: "root",
      depth: 2,
      name_en: "Child",
      name_ru: "Дочерний",
      slug: "child",
    });
    setupCategoriesData([root, child]);
    render(<MoneyCategoriesPage />);
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: "common.delete" })[0]);
    const openAlert = screen
      .getAllByTestId("alert-root")
      .find((el) => el.getAttribute("data-open") === "true");
    if (!openAlert) {
      throw new Error("Expected open alert dialog");
    }
    await user.click(within(openAlert).getByRole("button", { name: "common.delete" }));

    expect(toastMock.error).toHaveBeenCalledWith("money.cannotDeleteCategory");
    expect(deleteMutateAsync).not.toHaveBeenCalled();
  });

  it("deletes a leaf category after confirmation", async () => {
    const root = makeCategory({ id: "root", name_en: "Root", name_ru: "Корень", slug: "root" });
    const child = makeCategory({
      id: "child",
      parent_id: "root",
      depth: 2,
      name_en: "Child",
      name_ru: "Дочерний",
      slug: "child",
    });
    setupCategoriesData([root, child]);
    render(<MoneyCategoriesPage />);
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: "common.delete" })[1]);
    const openAlert = screen
      .getAllByTestId("alert-root")
      .find((el) => el.getAttribute("data-open") === "true");
    if (!openAlert) {
      throw new Error("Expected open alert dialog");
    }
    await user.click(within(openAlert).getByRole("button", { name: "common.delete" }));

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith("child");
    });
  });
});
