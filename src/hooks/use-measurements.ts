"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  Measurement,
  MeasurementSummary,
  MeasurementHistoryPoint,
  CreateMeasurementInput,
  UpdateMeasurementInput,
  MeasurementCategory,
} from "@/types";

// ============================================================================
// FETCH ALL MEASUREMENTS FOR A PERSON (aggregated by measurement type)
// ============================================================================
interface RawMeasurementRow {
  id: string;
  person_id: string;
  catalog_id: string;
  value: number;
  measured_at: string;
  notes: string | null;
  created_by_user_id: string;
  created_at: string;
  measurement_catalog: {
    code: string;
    name_ru: string;
    name_en: string;
    unit_ru: string;
    unit_en: string;
    category: MeasurementCategory;
    sort_order: number;
  };
}

async function fetchPersonMeasurements(
  personId: string,
  search?: string
): Promise<MeasurementSummary[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("measurements")
    .select(`
      id,
      person_id,
      catalog_id,
      value,
      measured_at,
      notes,
      created_by_user_id,
      created_at,
      measurement_catalog (
        code,
        name_ru,
        name_en,
        unit_ru,
        unit_en,
        category,
        sort_order
      )
    `)
    .eq("person_id", personId)
    .order("measured_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Group by catalog_id
  const measurementMap = new Map<string, MeasurementSummary>();

  for (const row of data as unknown as RawMeasurementRow[]) {
    const catalog = row.measurement_catalog;
    if (!catalog) continue;

    const historyPoint: MeasurementHistoryPoint = {
      id: row.id,
      value: row.value,
      measured_at: row.measured_at,
      notes: row.notes,
      created_at: row.created_at,
    };

    if (measurementMap.has(catalog.code)) {
      const existing = measurementMap.get(catalog.code)!;
      existing.history.push(historyPoint);
      existing.measurement_count++;
    } else {
      measurementMap.set(catalog.code, {
        code: catalog.code,
        catalog_id: row.catalog_id,
        name_ru: catalog.name_ru,
        name_en: catalog.name_en,
        unit_ru: catalog.unit_ru,
        unit_en: catalog.unit_en,
        category: catalog.category,
        latest_value: row.value,
        latest_date: row.measured_at,
        measurement_count: 1,
        history: [historyPoint],
      });
    }
  }

  // Convert map to array and sort history by date (oldest first for charts)
  let summaries = Array.from(measurementMap.values()).map((summary) => ({
    ...summary,
    history: summary.history.sort(
      (a, b) =>
        new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime()
    ),
  }));

  // Apply search filter if provided
  if (search && search.trim()) {
    const searchLower = search.toLowerCase().trim();
    summaries = summaries.filter((s) => {
      if (s.code.toLowerCase().includes(searchLower)) return true;
      if (s.name_ru.toLowerCase().includes(searchLower)) return true;
      if (s.name_en.toLowerCase().includes(searchLower)) return true;
      return false;
    });
  }

  // Sort by category order, then by name
  const categoryOrder: Record<MeasurementCategory, number> = {
    basic: 0,
    body: 1,
    limbs: 2,
    vital: 3,
  };

  summaries.sort((a, b) => {
    const catA = categoryOrder[a.category] ?? 99;
    const catB = categoryOrder[b.category] ?? 99;
    if (catA !== catB) return catA - catB;
    return a.name_en.localeCompare(b.name_en);
  });

  return summaries;
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
  code: string
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
      category: catalogData.category,
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
  history.sort(
    (a, b) =>
      new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime()
  );

  const latest = data[0]; // Already sorted descending, so first is latest

  return {
    code: catalogData.code,
    catalog_id: catalogData.id,
    name_ru: catalogData.name_ru,
    name_en: catalogData.name_en,
    unit_ru: catalogData.unit_ru,
    unit_en: catalogData.unit_en,
    category: catalogData.category,
    latest_value: latest.value,
    latest_date: latest.measured_at,
    measurement_count: data.length,
    history,
  };
}

export function useSingleMeasurementHistory(
  personId: string | null,
  code: string | null
) {
  return useQuery({
    queryKey: ["single-measurement-history", personId, code],
    queryFn: () => fetchSingleMeasurementHistory(personId!, code!),
    enabled: !!personId && !!code,
  });
}

// ============================================================================
// CREATE MEASUREMENT
// ============================================================================
async function createMeasurement(
  input: CreateMeasurementInput
): Promise<Measurement> {
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
async function deleteMeasurement({
  id,
}: {
  id: string;
  personId: string;
}): Promise<void> {
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
