"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { ObservationSummary, ObservationHistoryPoint, ObservationStatus } from "@/types";
import {
  OBSERVATION_LIST_SELECT,
  searchObservationSummaries,
  summarizeObservations,
  type ObservationListRow,
} from "@/types/observation-summary";

// ============================================================================
// FETCH ALL OBSERVATIONS FOR A PERSON (aggregated by obs_code/obs_name)
// ============================================================================
async function fetchPersonObservationHistory(
  personId: string,
  search?: string,
): Promise<ObservationSummary[]> {
  const supabase = createClient();

  // Applied observations of the person's active records, with the record's date.
  const { data, error } = await supabase
    .from("record_observations")
    .select(OBSERVATION_LIST_SELECT)
    .eq("medical_records.person_id", personId)
    .eq("medical_records.status", "active")
    .eq("is_applied", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  // Grouped by code, out-of-range ones first, then newest.
  return searchObservationSummaries(
    summarizeObservations((data ?? []) as unknown as ObservationListRow[]),
    search,
  );
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
  obsCode: string,
): Promise<ObservationSummary | null> {
  const supabase = createClient();

  // Fetch all instances of this observation
  const { data, error } = await supabase
    .from("record_observations")
    .select(
      `
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
        default_ref_low,
        default_ref_high
      )
    `,
    )
    .eq("medical_records.person_id", personId)
    .eq("medical_records.status", "active")
    .eq("is_applied", true) // Only show applied observations in history
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
      default_ref_low: number | null;
      default_ref_high: number | null;
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
    default_ref_low: first.observation_catalog?.default_ref_low ?? null,
    default_ref_high: first.observation_catalog?.default_ref_high ?? null,
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
