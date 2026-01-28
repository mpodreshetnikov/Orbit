"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  ObservationSummary,
  ObservationHistoryPoint,
  ObservationStatus,
} from "@/types";

// ============================================================================
// FETCH ALL OBSERVATIONS FOR A PERSON (aggregated by obs_code/obs_name)
// ============================================================================
async function fetchPersonObservationHistory(
  personId: string,
  search?: string
): Promise<ObservationSummary[]> {
  const supabase = createClient();

  // First, get all observations for active records of this person
  // Join with medical_records to get record_date and filter by person_id
  const query = supabase
    .from("record_observations")
    .select(`
      id,
      record_id,
      obs_code,
      obs_name,
      catalog_id,
      value_numeric,
      value_text,
      value_canonical,
      unit,
      unit_canonical,
      ref_range_low,
      ref_range_high,
      ref_range_low_canonical,
      ref_range_high_canonical,
      status,
      created_at,
      medical_records!inner(
        person_id,
        record_date,
        status
      ),
      observation_catalog(
        name_ru,
        name_en,
        canonical_unit,
        synonyms_ru,
        synonyms_en
      )
    `)
    .eq("medical_records.person_id", personId)
    .eq("medical_records.status", "active")
    .order("created_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Transform the data and group by obs_code or obs_name
  const observationMap = new Map<string, ObservationSummary>();

  for (const row of data as unknown[]) {
    const r = row as {
      id: string;
      record_id: string;
      obs_code: string | null;
      obs_name: string;
      catalog_id: string | null;
      value_numeric: number | null;
      value_text: string | null;
      value_canonical: number | null;
      unit: string | null;
      unit_canonical: string | null;
      ref_range_low: number | null;
      ref_range_high: number | null;
      ref_range_low_canonical: number | null;
      ref_range_high_canonical: number | null;
      status: string | null;
      created_at: string;
      medical_records: {
        person_id: string;
        record_date: string | null;
        status: string;
      };
      observation_catalog: {
        name_ru: string | null;
        name_en: string | null;
        canonical_unit: string | null;
        synonyms_ru: string[] | null;
        synonyms_en: string[] | null;
      } | null;
    };

    // Use obs_code as key if available, otherwise use normalized obs_name
    const key = r.obs_code || r.obs_name.toLowerCase().trim();
    
    const historyPoint: ObservationHistoryPoint = {
      id: r.id,
      record_id: r.record_id,
      record_date: r.medical_records.record_date,
      value_numeric: r.value_numeric,
      value_text: r.value_text,
      value_canonical: r.value_canonical,
      unit: r.unit,
      unit_canonical: r.unit_canonical,
      ref_range_low: r.ref_range_low,
      ref_range_high: r.ref_range_high,
      ref_range_low_canonical: r.ref_range_low_canonical,
      ref_range_high_canonical: r.ref_range_high_canonical,
      status: r.status as ObservationStatus | null,
      created_at: r.created_at,
    };

    if (observationMap.has(key)) {
      const existing = observationMap.get(key)!;
      existing.history.push(historyPoint);
      existing.measurement_count++;
    } else {
      observationMap.set(key, {
        obs_code: r.obs_code || key,
        obs_name: r.obs_name,
        catalog_id: r.catalog_id,
        catalog_name_ru: r.observation_catalog?.name_ru || null,
        catalog_name_en: r.observation_catalog?.name_en || null,
        canonical_unit: r.observation_catalog?.canonical_unit || r.unit_canonical,
        latest_value: r.value_canonical ?? r.value_numeric,
        latest_value_text: r.value_text,
        latest_unit: r.unit_canonical || r.unit,
        latest_status: r.status as ObservationStatus | null,
        latest_date: r.medical_records.record_date,
        latest_ref_low: r.ref_range_low,
        latest_ref_high: r.ref_range_high,
        latest_ref_low_canonical: r.ref_range_low_canonical,
        latest_ref_high_canonical: r.ref_range_high_canonical,
        measurement_count: 1,
        history: [historyPoint],
      });
    }
  }

  // Convert map to array and sort history by date (oldest first for charts)
  let summaries = Array.from(observationMap.values()).map(summary => ({
    ...summary,
    history: summary.history.sort((a, b) => {
      const dateA = a.record_date || a.created_at;
      const dateB = b.record_date || b.created_at;
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    }),
  }));

  // Apply search filter if provided
  if (search && search.trim()) {
    const searchLower = search.toLowerCase().trim();
    summaries = summaries.filter(s => {
      // Search in obs_name
      if (s.obs_name.toLowerCase().includes(searchLower)) return true;
      // Search in obs_code
      if (s.obs_code.toLowerCase().includes(searchLower)) return true;
      // Search in catalog names
      if (s.catalog_name_ru?.toLowerCase().includes(searchLower)) return true;
      if (s.catalog_name_en?.toLowerCase().includes(searchLower)) return true;
      return false;
    });
  }

  // Sort: bad observations first (not normal), then by name
  summaries.sort((a, b) => {
    const aIsBad = a.latest_status && a.latest_status !== "normal" && a.latest_status !== "unknown";
    const bIsBad = b.latest_status && b.latest_status !== "normal" && b.latest_status !== "unknown";
    
    if (aIsBad && !bIsBad) return -1;
    if (!aIsBad && bIsBad) return 1;
    
    // Then sort by name
    return a.obs_name.localeCompare(b.obs_name);
  });

  return summaries;
}

export function usePersonObservationHistory(personId: string | null, search?: string) {
  return useQuery({
    queryKey: ["person-observation-history", personId, search],
    queryFn: () => fetchPersonObservationHistory(personId!, search),
    enabled: !!personId,
  });
}

// ============================================================================
// FETCH SINGLE OBSERVATION HISTORY (for detail page)
// ============================================================================
async function fetchSingleObservationHistory(
  personId: string,
  obsCode: string
): Promise<ObservationSummary | null> {
  const supabase = createClient();

  // Fetch all instances of this observation
  const { data, error } = await supabase
    .from("record_observations")
    .select(`
      id,
      record_id,
      obs_code,
      obs_name,
      catalog_id,
      value_numeric,
      value_text,
      value_canonical,
      unit,
      unit_canonical,
      ref_range_low,
      ref_range_high,
      ref_range_low_canonical,
      ref_range_high_canonical,
      status,
      created_at,
      medical_records!inner(
        person_id,
        record_date,
        status
      ),
      observation_catalog(
        name_ru,
        name_en,
        canonical_unit
      )
    `)
    .eq("medical_records.person_id", personId)
    .eq("medical_records.status", "active")
    .or(`obs_code.eq.${obsCode},obs_name.ilike.${obsCode}`)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Build the summary from the data
  const first = data[0] as unknown as {
    id: string;
    record_id: string;
    obs_code: string | null;
    obs_name: string;
    catalog_id: string | null;
    value_numeric: number | null;
    value_text: string | null;
    value_canonical: number | null;
    unit: string | null;
    unit_canonical: string | null;
    ref_range_low: number | null;
    ref_range_high: number | null;
    ref_range_low_canonical: number | null;
    ref_range_high_canonical: number | null;
    status: string | null;
    created_at: string;
    medical_records: {
      person_id: string;
      record_date: string | null;
      status: string;
    };
    observation_catalog: {
      name_ru: string | null;
      name_en: string | null;
      canonical_unit: string | null;
    } | null;
  };

  const history: ObservationHistoryPoint[] = data.map((r: unknown) => {
    const row = r as typeof first;
    return {
      id: row.id,
      record_id: row.record_id,
      record_date: row.medical_records.record_date,
      value_numeric: row.value_numeric,
      value_text: row.value_text,
      value_canonical: row.value_canonical,
      unit: row.unit,
      unit_canonical: row.unit_canonical,
      ref_range_low: row.ref_range_low,
      ref_range_high: row.ref_range_high,
      ref_range_low_canonical: row.ref_range_low_canonical,
      ref_range_high_canonical: row.ref_range_high_canonical,
      status: row.status as ObservationStatus | null,
      created_at: row.created_at,
    };
  });

  // Sort history by date (oldest first for charts)
  history.sort((a, b) => {
    const dateA = a.record_date || a.created_at;
    const dateB = b.record_date || b.created_at;
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  });

  return {
    obs_code: first.obs_code || obsCode,
    obs_name: first.obs_name,
    catalog_id: first.catalog_id,
    catalog_name_ru: first.observation_catalog?.name_ru || null,
    catalog_name_en: first.observation_catalog?.name_en || null,
    canonical_unit: first.observation_catalog?.canonical_unit || first.unit_canonical,
    latest_value: first.value_canonical ?? first.value_numeric,
    latest_value_text: first.value_text,
    latest_unit: first.unit_canonical || first.unit,
    latest_status: first.status as ObservationStatus | null,
    latest_date: first.medical_records.record_date,
    latest_ref_low: first.ref_range_low,
    latest_ref_high: first.ref_range_high,
    latest_ref_low_canonical: first.ref_range_low_canonical,
    latest_ref_high_canonical: first.ref_range_high_canonical,
    measurement_count: data.length,
    history,
  };
}

export function useSingleObservationHistory(personId: string | null, obsCode: string | null) {
  return useQuery({
    queryKey: ["single-observation-history", personId, obsCode],
    queryFn: () => fetchSingleObservationHistory(personId!, obsCode!),
    enabled: !!personId && !!obsCode,
  });
}
