"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import {
  MEASUREMENT_LIST_SELECT,
  normalizeMeasurementCategory,
  searchMeasurementSummaries,
  summarizeMeasurements,
  type MeasurementListRow,
} from "@/types/measurement-summary";
import type {
  Measurement,
  MeasurementSummary,
  MeasurementHistoryPoint,
  CreateMeasurementInput,
  UpdateMeasurementInput,
} from "@/types";

// ============================================================================
// FETCH ALL MEASUREMENTS FOR A PERSON (aggregated by measurement type)
// ============================================================================
async function fetchPersonMeasurements(
  personId: string,
  search?: string,
): Promise<MeasurementSummary[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("measurements")
    .select(MEASUREMENT_LIST_SELECT)
    .eq("person_id", personId)
    .order("measured_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  // Sorted by category, then by the catalog's sort_order so left/right pairs of
  // the same body part stay next to each other.
  return searchMeasurementSummaries(
    summarizeMeasurements((data ?? []) as unknown as MeasurementListRow[]),
    search,
  );
}

export function usePersonMeasurements(personId: string | null, search?: string) {
  return useQuery({
    queryKey: ["person-measurements", personId, search],
    queryFn: () => fetchPersonMeasurements(personId!, search),
    enabled: !!personId,
  });
}

// ============================================================================
// FETCH SINGLE MEASUREMENT TYPE HISTORY (for detail page)
// ============================================================================
async function fetchSingleMeasurementHistory(
  personId: string,
  code: string,
): Promise<MeasurementSummary | null> {
  const supabase = createClient();

  // First, get the catalog entry by code
  const { data: catalogData, error: catalogError } = await supabase
    .from("measurement_catalog")
    .select("*")
    .eq("code", code)
    .single();

  if (catalogError) {
    if (catalogError.code === "PGRST116") {
      return null; // Not found
    }
    throw new Error(catalogError.message);
  }

  // Fetch all measurements of this type for the person
  const { data, error } = await supabase
    .from("measurements")
    .select("*")
    .eq("person_id", personId)
    .eq("catalog_id", catalogData.id)
    .order("measured_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return {
      code: catalogData.code,
      catalog_id: catalogData.id,
      name_ru: catalogData.name_ru,
      name_en: catalogData.name_en,
      unit_ru: catalogData.unit_ru,
      unit_en: catalogData.unit_en,
      category: normalizeMeasurementCategory(catalogData.category),
      sort_order: catalogData.sort_order,
      latest_value: 0,
      latest_date: "",
      measurement_count: 0,
      history: [],
    };
  }

  const history: MeasurementHistoryPoint[] = data.map((row) => ({
    id: row.id,
    value: row.value,
    measured_at: row.measured_at,
    notes: row.notes,
    created_at: row.created_at,
  }));

  // Sort history by date (oldest first for charts)
  history.sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());

  const latest = data[0]; // Already sorted descending, so first is latest

  return {
    code: catalogData.code,
    catalog_id: catalogData.id,
    name_ru: catalogData.name_ru,
    name_en: catalogData.name_en,
    unit_ru: catalogData.unit_ru,
    unit_en: catalogData.unit_en,
    category: normalizeMeasurementCategory(catalogData.category),
    sort_order: catalogData.sort_order,
    latest_value: latest.value,
    latest_date: latest.measured_at,
    measurement_count: data.length,
    history,
  };
}

export function useSingleMeasurementHistory(personId: string | null, code: string | null) {
  return useQuery({
    queryKey: ["single-measurement-history", personId, code],
    queryFn: () => fetchSingleMeasurementHistory(personId!, code!),
    enabled: !!personId && !!code,
  });
}

// ============================================================================
// CREATE MEASUREMENT
// ============================================================================
async function createMeasurement(input: CreateMeasurementInput): Promise<Measurement> {
  const supabase = createClient();

  // Get the current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("measurements")
    .insert({
      person_id: input.person_id,
      catalog_id: input.catalog_id,
      value: input.value,
      measured_at: input.measured_at || new Date().toISOString(),
      notes: input.notes || null,
      created_by_user_id: user.id,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Measurement;
}

export function useCreateMeasurement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMeasurement,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["person-measurements", data.person_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["single-measurement-history", data.person_id],
      });
    },
  });
}

// ============================================================================
// UPDATE MEASUREMENT
// ============================================================================
async function updateMeasurement({
  id,
  updates,
}: {
  id: string;
  personId: string;
  updates: UpdateMeasurementInput;
}): Promise<Measurement> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("measurements")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Measurement;
}

export function useUpdateMeasurement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateMeasurement,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["person-measurements", data.person_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["single-measurement-history", data.person_id],
      });
    },
  });
}

// ============================================================================
// DELETE MEASUREMENT
// ============================================================================
async function deleteMeasurement({ id }: { id: string; personId: string }): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from("measurements").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteMeasurement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteMeasurement,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["person-measurements", variables.personId],
      });
      queryClient.invalidateQueries({
        queryKey: ["single-measurement-history", variables.personId],
      });
    },
  });
}
