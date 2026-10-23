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
