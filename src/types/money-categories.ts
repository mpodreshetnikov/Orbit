import type { MoneyCategory } from "./money";

/** The category tree the web pages and the phone draw: canonical first, then custom under theirs. */

export interface MoneyCategoryTreeNode extends MoneyCategory {
  children: MoneyCategoryTreeNode[];
}

function getMoneyCategoryKind(category: Partial<MoneyCategory>): MoneyCategory["category_kind"] {
  return category.category_kind ?? "custom";
}

function getMoneyCategorySortOrder(category: Partial<MoneyCategory>): number {
  return category.sort_order ?? 0;
}

function compareMoneyCategories(a: Partial<MoneyCategory>, b: Partial<MoneyCategory>): number {
  const kindCompare =
    getMoneyCategoryKind(a) === getMoneyCategoryKind(b)
      ? 0
      : getMoneyCategoryKind(a) === "canonical"
        ? -1
        : 1;
  if (kindCompare !== 0) return kindCompare;
  if (getMoneyCategorySortOrder(a) !== getMoneyCategorySortOrder(b)) {
    return getMoneyCategorySortOrder(a) - getMoneyCategorySortOrder(b);
  }
  if ((a.depth ?? 0) !== (b.depth ?? 0)) {
    return (a.depth ?? 0) - (b.depth ?? 0);
  }
  return (a.name_en ?? "").localeCompare(b.name_en ?? "");
}

export function sortMoneyCategories(categories: MoneyCategory[]): MoneyCategory[] {
  return [...categories].sort(compareMoneyCategories);
}

export function buildMoneyCategoryTree(categories: MoneyCategory[]): MoneyCategoryTreeNode[] {
  const nodes = new Map<string, MoneyCategoryTreeNode>();
  categories.forEach((c) => nodes.set(c.id, { ...c, children: [] }));

  const roots: MoneyCategoryTreeNode[] = [];
  nodes.forEach((node) => {
    if (node.parent_id && nodes.has(node.parent_id)) {
      nodes.get(node.parent_id)!.children.push(node);
      return;
    }

    if (
      getMoneyCategoryKind(node) === "custom" &&
      node.canonical_category_id &&
      node.canonical_category_id !== node.id &&
      nodes.has(node.canonical_category_id)
    ) {
      nodes.get(node.canonical_category_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNode = (list: MoneyCategoryTreeNode[]) => {
    list.sort(compareMoneyCategories);
    list.forEach((n) => sortNode(n.children));
  };
  sortNode(roots);

  return roots;
}

export function flattenMoneyCategoryTree(nodes: MoneyCategoryTreeNode[]): MoneyCategoryTreeNode[] {
  const result: MoneyCategoryTreeNode[] = [];
  const walk = (list: MoneyCategoryTreeNode[]) => {
    list.forEach((node) => {
      result.push(node);
      if (node.children.length > 0) walk(node.children);
    });
  };
  walk(nodes);
  return result;
}

/** How deep a custom branch may go under its canonical category. */
export const MAX_CATEGORY_DEPTH = 4;

/** The category dialog's fields, as typed. */
export interface CategoryForm {
  nameEn: string;
  nameRu: string;
  slug: string;
  canonicalId: string | null;
  parentId: string | null;
}

export const EMPTY_CATEGORY_FORM: CategoryForm = {
  nameEn: "",
  nameRu: "",
  slug: "",
  canonicalId: null,
  parentId: null,
};

export function categoryFormOf(category: MoneyCategory): CategoryForm {
  return {
    nameEn: category.name_en,
    nameRu: category.name_ru,
    slug: category.slug,
    canonicalId: category.canonical_category_id,
    parentId: category.parent_id,
  };
}

/** A new category under `parent`, or null when the parent is already as deep as a branch goes. */
export function childCategoryForm(parent: MoneyCategory): CategoryForm | null {
  if (parent.category_kind === "canonical")
    return { ...EMPTY_CATEGORY_FORM, canonicalId: parent.id };
  if (parent.depth >= MAX_CATEGORY_DEPTH) return null;
  return { ...EMPTY_CATEGORY_FORM, canonicalId: parent.canonical_category_id, parentId: parent.id };
}

/** The canonical branches a custom category can hang under, in their own order. */
export function canonicalCategoryOptions(categories: MoneyCategory[]): MoneyCategory[] {
  return categories
    .filter((category) => category.category_kind === "canonical")
    .sort((a, b) => a.sort_order - b.sort_order || a.name_en.localeCompare(b.name_en));
}

/** The custom categories of `canonicalId` that can take a child, but never the one being edited. */
export function parentCategoryOptions(
  categories: MoneyCategory[],
  canonicalId: string | null,
  editingId?: string,
): MoneyCategory[] {
  return categories
    .filter(
      (category) =>
        category.category_kind === "custom" &&
        category.depth < MAX_CATEGORY_DEPTH &&
        category.id !== editingId &&
        category.canonical_category_id === canonicalId,
    )
    .sort((a, b) => a.depth - b.depth || a.name_en.localeCompare(b.name_en));
}

export function categoryHasChildren(categories: MoneyCategory[], id: string): boolean {
  return categories.some((category) => category.parent_id === id);
}

/** What a custom category is saved as, or why it cannot be: a field left empty, or too deep. */
export function categoryColumns(
  categories: MoneyCategory[],
  form: CategoryForm,
):
  | {
      columns: {
        parent_id: string | null;
        canonical_category_id: string;
        depth: number;
        name_en: string;
        name_ru: string;
        slug: string;
      };
    }
  | { problem: "required" | "depth" } {
  const nameEn = form.nameEn.trim();
  const nameRu = form.nameRu.trim();
  const slug = form.slug.trim();
  const canonical = categories.find(
    (category) => category.id === form.canonicalId && category.category_kind === "canonical",
  );
  if (!nameEn || !nameRu || !slug || !canonical) return { problem: "required" };
  const parent = categories.find(
    (category) =>
      category.id === form.parentId &&
      category.category_kind === "custom" &&
      category.canonical_category_id === canonical.id,
  );
  const depth = parent ? parent.depth + 1 : 1;
  if (depth > MAX_CATEGORY_DEPTH) return { problem: "depth" };
  return {
    columns: {
      parent_id: parent?.id ?? null,
      canonical_category_id: canonical.id,
      depth,
      name_en: nameEn,
      name_ru: nameRu,
      slug,
    },
  };
}
