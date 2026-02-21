"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  ObservationCatalog,
  CreateObservationInput,
  UpdateObservationInput,
} from "@/types";
import type { Database, Json } from "@/types/database";

type ObservationInsert = Database["public"]["Tables"]["observation_catalog"]["Insert"];
type ObservationUpdate = Database["public"]["Tables"]["observation_catalog"]["Update"];

// ============================================================================
// FETCH ALL OBSERVATIONS
// ============================================================================
async function fetchObservationCatalog(
  search?: string
): Promise<ObservationCatalog[]> {
  const supabase = createClient();

  let query = supabase
    .from("observation_catalog")
    .select("*")
    .order("obs_code", { ascending: true });

  // If search is provided, filter by obs_code, name_ru, or name_en
  if (search && search.trim()) {
    const searchTerm = `%${search.trim().toLowerCase()}%`;
    query = query.or(
      `obs_code.ilike.${searchTerm},name_ru.ilike.${searchTerm},name_en.ilike.${searchTerm}`
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ObservationCatalog[];
}

export function useObservationCatalog(search?: string) {
  return useQuery({
    queryKey: ["observation-catalog", search],
    queryFn: () => fetchObservationCatalog(search),
  });
}

// ============================================================================
// FETCH SINGLE OBSERVATION
// ============================================================================
async function fetchObservation(
  id: string
): Promise<ObservationCatalog | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("observation_catalog")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw new Error(error.message);
  }

  return data as ObservationCatalog;
}

export function useObservation(id: string | null) {
  return useQuery({
    queryKey: ["observation", id],
    queryFn: () => fetchObservation(id!),
    enabled: !!id,
  });
}

// ============================================================================
// CREATE OBSERVATION
// ============================================================================
async function createObservation(
  input: CreateObservationInput
): Promise<ObservationCatalog> {
  const supabase = createClient();
  const payload: ObservationInsert = {
    obs_code: input.obs_code,
    name_ru: input.name_ru,
    name_en: input.name_en,
    canonical_unit: input.canonical_unit,
    synonyms_ru: input.synonyms_ru || [],
    synonyms_en: input.synonyms_en || [],
    accepted_units: (input.accepted_units || {}) as unknown as Json,
    notes: input.notes || null,
    default_ref_low: input.default_ref_low ?? null,
    default_ref_high: input.default_ref_high ?? null,
  };

  const { data, error } = await supabase
    .from("observation_catalog")
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ObservationCatalog;
}

export function useCreateObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createObservation,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["observation-catalog"],
      });
    },
  });
}

// ============================================================================
// UPDATE OBSERVATION
// ============================================================================
async function updateObservation({
  id,
  updates,
}: {
  id: string;
  updates: UpdateObservationInput;
}): Promise<ObservationCatalog> {
  const supabase = createClient();
  const { accepted_units, ...rest } = updates;
  const payload: ObservationUpdate = {
    ...rest,
    accepted_units:
      accepted_units === undefined
        ? undefined
        : (accepted_units as unknown as Json),
  };

  const { data, error } = await supabase
    .from("observation_catalog")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ObservationCatalog;
}

export function useUpdateObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateObservation,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["observation-catalog"],
      });
      queryClient.invalidateQueries({
        queryKey: ["observation", data.id],
      });
    },
  });
}

// ============================================================================
// DELETE OBSERVATION
// ============================================================================
async function deleteObservation(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("observation_catalog")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteObservation,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["observation-catalog"],
      });
    },
  });
}
