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

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <div role="combobox" aria-controls="mock-listbox" aria-expanded={false}>
        {children}
      </div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? ""}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const ctx = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => ctx.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

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
    canonical_category_id: "canon-food",
    category_kind: "custom",
    system_key: null,
    sort_order: 0,
    created_by: null,
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
  type TreeNode = MoneyCategory & { children: TreeNode[] };
  const mapNode = (category: MoneyCategory): TreeNode => ({
    ...category,
    children: (byParent.get(category.id) ?? []).map((c) => mapNode(c)),
  });
  return (byParent.get(null) ?? []).map(mapNode);
}

function flattenTree(
  nodes: Array<MoneyCategory & { children: Array<MoneyCategory & { children: unknown[] }> }>,
) {
  const result: Array<MoneyCategory & { children: unknown[] }> = [];
  const visit = (node: MoneyCategory & { children: unknown[] }) => {
    result.push(node);
    node.children.forEach((child) => visit(child as MoneyCategory & { children: unknown[] }));
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

  it("creates a root custom category within the selected canonical branch", async () => {
    const canonical = makeCategory({
      id: "canon-transport",
      canonical_category_id: "canon-transport",
      category_kind: "canonical",
      system_key: "transport",
      sort_order: 1,
      name_en: "Transport",
      name_ru: "Transport RU",
      slug: "canonical-transport",
    });
    setupCategoriesData([canonical]);
    render(<MoneyCategoriesPage />);
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: "money.addCategory" })[0]);
    await user.click(screen.getByRole("button", { name: "Transport" }));
    const textboxes = screen.getAllByRole("textbox");
    await user.type(textboxes[0], "Metro");
    await user.type(textboxes[1], "Metro RU");
    await user.type(textboxes[2], "metro");
    await user.click(screen.getAllByRole("button", { name: "common.save" })[0]);

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({
        parent_id: null,
        canonical_category_id: "canon-transport",
        category_kind: "custom",
        depth: 1,
        name_en: "Metro",
        name_ru: "Metro RU",
        slug: "metro",
      });
    });
  });

  it("creates a child category from tree action with incremented depth", async () => {
    const canonical = makeCategory({
      id: "canon-food",
      canonical_category_id: "canon-food",
      category_kind: "canonical",
      system_key: "food",
      sort_order: 1,
      name_en: "Food",
      name_ru: "Food RU",
      slug: "canonical-food",
    });
    const root = makeCategory({
      id: "root",
      depth: 1,
      name_en: "Root",
      name_ru: "Root",
      slug: "root",
    });
    setupCategoriesData([canonical, root]);
    render(<MoneyCategoriesPage />);
    const user = userEvent.setup();

    const addButtons = screen.getAllByRole("button", { name: "money.addCategory" });
    await user.click(addButtons[2]);

    const textboxes = screen.getAllByRole("textbox");
    await user.type(textboxes[0], "Child");
    await user.type(textboxes[1], "Child RU");
    await user.type(textboxes[2], "child");
    await user.click(screen.getAllByRole("button", { name: "common.save" })[0]);

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith({
        parent_id: "root",
        canonical_category_id: "canon-food",
        category_kind: "custom",
        depth: 2,
        name_en: "Child",
        name_ru: "Child RU",
        slug: "child",
      });
    });
  });

  it("updates an existing category via edit action", async () => {
    const canonical = makeCategory({
      id: "canon-food",
      canonical_category_id: "canon-food",
      category_kind: "canonical",
      system_key: "food",
      sort_order: 1,
      name_en: "Food",
      name_ru: "Food RU",
      slug: "canonical-food",
    });
    const root = makeCategory({
      id: "root",
      depth: 1,
      name_en: "Root",
      name_ru: "Root",
      slug: "root",
    });
    setupCategoriesData([canonical, root]);
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
          canonical_category_id: "canon-food",
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

  it("renders canonical rows as locked branch roots", () => {
    const canonical = makeCategory({
      id: "canon-food",
      canonical_category_id: "canon-food",
      category_kind: "canonical",
      system_key: "food",
      sort_order: 1,
      name_en: "Food",
      name_ru: "Food RU",
      slug: "canonical-food",
    });
    const custom = makeCategory({
      id: "custom-groceries",
      canonical_category_id: "canon-food",
      category_kind: "custom",
      system_key: null,
      name_en: "Groceries",
      name_ru: "Groceries RU",
      slug: "groceries",
    });
    setupCategoriesData([canonical, custom]);

    render(<MoneyCategoriesPage />);

    expect(screen.getByText("money.categoryCanonical")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "common.edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "common.delete" })).toHaveLength(1);
  });

  it("blocks deleting a category that has children", async () => {
    const root = makeCategory({
      id: "root",
      name_en: "Root",
      name_ru: "Корень",
      slug: "root",
    });
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
    const root = makeCategory({
      id: "root",
      name_en: "Root",
      name_ru: "Корень",
      slug: "root",
    });
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
