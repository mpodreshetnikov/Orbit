"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { MoneyCategory, CreateMoneyCategoryInput, UpdateMoneyCategoryInput } from "@/types";

export {
  buildMoneyCategoryTree,
  flattenMoneyCategoryTree,
  sortMoneyCategories,
  type MoneyCategoryTreeNode,
} from "@/types/money-categories";

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
