"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  BodySiteCatalog,
  CreateBodySiteInput,
  UpdateBodySiteInput,
} from "@/types";

// ============================================================================
// FETCH ALL BODY SITES
// ============================================================================
async function fetchBodySiteCatalog(): Promise<BodySiteCatalog[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("body_site_catalog")
    .select("*")
    .order("site_code");

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as BodySiteCatalog[];
}

export function useBodySiteCatalog() {
  return useQuery({
    queryKey: ["body-site-catalog"],
    queryFn: fetchBodySiteCatalog,
    staleTime: 1000 * 60 * 10, // 10 minutes - catalog doesn't change often
  });
}

// ============================================================================
// CREATE BODY SITE
// ============================================================================
async function createBodySite(
  input: CreateBodySiteInput
): Promise<BodySiteCatalog> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("body_site_catalog")
    .insert({
      site_code: input.site_code,
      name_ru: input.name_ru,
      name_en: input.name_en,
      parent_site_code: input.parent_site_code || null,
      synonyms_ru: input.synonyms_ru || [],
      synonyms_en: input.synonyms_en || [],
      notes: input.notes || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as BodySiteCatalog;
}

export function useCreateBodySite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createBodySite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["body-site-catalog"] });
    },
  });
}

// ============================================================================
// UPDATE BODY SITE
// ============================================================================
async function updateBodySite({
  id,
  updates,
}: {
  id: string;
  updates: UpdateBodySiteInput;
}): Promise<BodySiteCatalog> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("body_site_catalog")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as BodySiteCatalog;
}

export function useUpdateBodySite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateBodySite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["body-site-catalog"] });
    },
  });
}

// ============================================================================
// DELETE BODY SITE
// ============================================================================
async function deleteBodySite(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("body_site_catalog")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteBodySite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteBodySite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["body-site-catalog"] });
    },
  });
}
