"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { MoneyCategory, CreateMoneyCategoryInput, UpdateMoneyCategoryInput } from "@/types";

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

async function fetchMoneyCategories(): Promise<MoneyCategory[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_categories")
    .select("*")
    .order("category_kind", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("depth", { ascending: true })
    .order("name_en", { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as MoneyCategory[];
}

export function useMoneyCategories() {
  return useQuery({
    queryKey: ["money-categories"],
    queryFn: fetchMoneyCategories,
  });
}

async function createMoneyCategory(input: CreateMoneyCategoryInput): Promise<MoneyCategory> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_categories")
    .insert({
      parent_id: input.parent_id ?? null,
      canonical_category_id: input.canonical_category_id,
      category_kind: input.category_kind ?? "custom",
      depth: input.depth,
      name_ru: input.name_ru,
      name_en: input.name_en,
      slug: input.slug,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as MoneyCategory;
}

export function useCreateMoneyCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMoneyCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["money-categories"] });
    },
  });
}

async function updateMoneyCategory({
  id,
  updates,
}: {
  id: string;
  updates: UpdateMoneyCategoryInput;
}): Promise<MoneyCategory> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_categories")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as MoneyCategory;
}

export function useUpdateMoneyCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMoneyCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["money-categories"] });
    },
  });
}

async function deleteMoneyCategory(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("money_categories").delete().eq("id", id);

  if (error) throw new Error(error.message);
}

export function useDeleteMoneyCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMoneyCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["money-categories"] });
    },
  });
}
