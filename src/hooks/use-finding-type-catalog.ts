"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  FindingTypeCatalog,
  CreateFindingTypeInput,
  UpdateFindingTypeInput,
} from "@/types";

// ============================================================================
// FETCH ALL FINDING TYPES
// ============================================================================
async function fetchFindingTypeCatalog(): Promise<FindingTypeCatalog[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("finding_type_catalog")
    .select("*")
    .order("finding_code");

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as FindingTypeCatalog[];
}

export function useFindingTypeCatalog() {
  return useQuery({
    queryKey: ["finding-type-catalog"],
    queryFn: fetchFindingTypeCatalog,
    staleTime: 1000 * 60 * 10, // 10 minutes - catalog doesn't change often
  });
}

// ============================================================================
// CREATE FINDING TYPE
// ============================================================================
async function createFindingType(
  input: CreateFindingTypeInput
): Promise<FindingTypeCatalog> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("finding_type_catalog")
    .insert({
      finding_code: input.finding_code,
      name_ru: input.name_ru,
      name_en: input.name_en,
      synonyms_ru: input.synonyms_ru || [],
      synonyms_en: input.synonyms_en || [],
      notes: input.notes || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as FindingTypeCatalog;
}

export function useCreateFindingType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createFindingType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finding-type-catalog"] });
    },
  });
}

// ============================================================================
// UPDATE FINDING TYPE
// ============================================================================
async function updateFindingType({
  id,
  updates,
}: {
  id: string;
  updates: UpdateFindingTypeInput;
}): Promise<FindingTypeCatalog> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("finding_type_catalog")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as FindingTypeCatalog;
}

export function useUpdateFindingType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateFindingType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finding-type-catalog"] });
    },
  });
}

// ============================================================================
// DELETE FINDING TYPE
// ============================================================================
async function deleteFindingType(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("finding_type_catalog")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteFindingType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteFindingType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finding-type-catalog"] });
    },
  });
}
