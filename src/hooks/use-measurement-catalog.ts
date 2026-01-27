"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  MeasurementCatalog,
  CreateMeasurementCatalogInput,
  UpdateMeasurementCatalogInput,
} from "@/types";

// ============================================================================
// FETCH ALL MEASUREMENT CATALOG ITEMS
// ============================================================================
async function fetchMeasurementCatalog(
  search?: string
): Promise<MeasurementCatalog[]> {
  const supabase = createClient();

  let query = supabase
    .from("measurement_catalog")
    .select("*")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });

  // If search is provided, filter by code, name_ru, or name_en
  if (search && search.trim()) {
    const searchTerm = `%${search.trim().toLowerCase()}%`;
    query = query.or(
      `code.ilike.${searchTerm},name_ru.ilike.${searchTerm},name_en.ilike.${searchTerm}`
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as MeasurementCatalog[];
}

export function useMeasurementCatalog(search?: string) {
  return useQuery({
    queryKey: ["measurement-catalog", search],
    queryFn: () => fetchMeasurementCatalog(search),
  });
}

// ============================================================================
// FETCH SINGLE MEASUREMENT CATALOG ITEM
// ============================================================================
async function fetchMeasurementCatalogItem(
  id: string
): Promise<MeasurementCatalog | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("measurement_catalog")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw new Error(error.message);
  }

  return data as MeasurementCatalog;
}

export function useMeasurementCatalogItem(id: string | null) {
  return useQuery({
    queryKey: ["measurement-catalog-item", id],
    queryFn: () => fetchMeasurementCatalogItem(id!),
    enabled: !!id,
  });
}

// ============================================================================
// FETCH BY CODE
// ============================================================================
async function fetchMeasurementCatalogByCode(
  code: string
): Promise<MeasurementCatalog | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("measurement_catalog")
    .select("*")
    .eq("code", code)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw new Error(error.message);
  }

  return data as MeasurementCatalog;
}

export function useMeasurementCatalogByCode(code: string | null) {
  return useQuery({
    queryKey: ["measurement-catalog-code", code],
    queryFn: () => fetchMeasurementCatalogByCode(code!),
    enabled: !!code,
  });
}

// ============================================================================
// CREATE MEASUREMENT CATALOG ITEM
// ============================================================================
async function createMeasurementCatalogItem(
  input: CreateMeasurementCatalogInput
): Promise<MeasurementCatalog> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("measurement_catalog")
    .insert({
      code: input.code,
      name_ru: input.name_ru,
      name_en: input.name_en,
      unit_ru: input.unit_ru,
      unit_en: input.unit_en,
      category: input.category,
      sort_order: input.sort_order || 0,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as MeasurementCatalog;
}

export function useCreateMeasurementCatalogItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMeasurementCatalogItem,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["measurement-catalog"],
      });
    },
  });
}

// ============================================================================
// UPDATE MEASUREMENT CATALOG ITEM
// ============================================================================
async function updateMeasurementCatalogItem({
  id,
  updates,
}: {
  id: string;
  updates: UpdateMeasurementCatalogInput;
}): Promise<MeasurementCatalog> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("measurement_catalog")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as MeasurementCatalog;
}

export function useUpdateMeasurementCatalogItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateMeasurementCatalogItem,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["measurement-catalog"],
      });
      queryClient.invalidateQueries({
        queryKey: ["measurement-catalog-item", data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["measurement-catalog-code", data.code],
      });
    },
  });
}

// ============================================================================
// DELETE MEASUREMENT CATALOG ITEM
// ============================================================================
async function deleteMeasurementCatalogItem(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("measurement_catalog")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteMeasurementCatalogItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteMeasurementCatalogItem,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["measurement-catalog"],
      });
    },
  });
}
