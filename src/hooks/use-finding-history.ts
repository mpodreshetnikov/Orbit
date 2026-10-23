"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import {
  FINDING_LIST_SELECT,
  resolvedFindingRow,
  searchFindingSummaries,
  summarizeFindings,
  type FindingListRow,
} from "@/types/finding-summary";
import type {
  FindingSummary,
  FindingHistoryPoint,
  FindingSeverity,
  FindingLaterality,
} from "@/types";

// ============================================================================
// FETCH ALL FINDINGS FOR A PERSON (aggregated by finding_code + site_code)
// ============================================================================
async function fetchPersonFindingHistory(
  personId: string,
  search?: string,
): Promise<FindingSummary[]> {
  const supabase = createClient();

  // Fetch all findings for active records of this person (history baseline)
  const { data, error } = await supabase
    .from("record_findings")
    .select(FINDING_LIST_SELECT)
    .eq("medical_records.person_id", personId)
    .eq("medical_records.status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  // Severe findings first, then the most recent.
  return searchFindingSummaries(
    summarizeFindings((data ?? []) as unknown as FindingListRow[]),
    search,
  );
}

export function usePersonFindingHistory(personId: string | null, search?: string) {
  return useQuery({
    queryKey: ["person-finding-history", personId, search],
    queryFn: () => fetchPersonFindingHistory(personId!, search),
    enabled: !!personId,
  });
}

// ============================================================================
// FETCH SINGLE FINDING TYPE HISTORY (for detail page)
// ============================================================================
async function fetchSingleFindingHistory(
  personId: string,
  findingCode: string,
  siteCode?: string,
): Promise<FindingSummary | null> {
  const supabase = createClient();

  // Build query
  let query = supabase
    .from("record_findings")
    .select(
      `
      id,
      record_id,
      finding_type_id,
      finding_code,
      finding_type_text,
      body_site_id,
      site_code,
      body_site_text,
      size_mm,
      count,
      resolution_status,
      severity,
      laterality,
      morphology,
      description,
      histology,
      source_anchor,
      created_at,
      medical_records!inner(
        person_id,
        record_date,
        status
      ),
      finding_type_catalog(
        name_ru,
        name_en
      ),
      body_site_catalog(
        name_ru,
        name_en
      )
    `,
    )
    .eq("medical_records.person_id", personId)
    .eq("medical_records.status", "active")
    .or(`finding_code.eq.${findingCode},finding_type_text.ilike.${findingCode}`);

  // Filter by site if provided
  if (siteCode) {
    query = query.or(`site_code.eq.${siteCode},body_site_text.ilike.${siteCode}`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Build history from data
  const history: FindingHistoryPoint[] = data.map((r: unknown) => {
    const row = r as FindingListRow;
    return {
      id: row.id,
      record_id: row.record_id,
      record_date: row.medical_records.record_date,
      size_mm: row.size_mm,
      count: row.count,
      resolution_status: row.resolution_status,
      severity: row.severity as FindingSeverity,
      laterality: row.laterality as FindingLaterality,
      morphology: row.morphology,
      description: row.description,
      histology: row.histology,
      source_anchor: row.source_anchor,
      created_at: row.created_at,
    };
  });

  // Sort history by date (newest first for display)
  history.sort((a, b) => {
    const dateA = a.record_date || a.created_at;
    const dateB = b.record_date || b.created_at;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  // Find the most recent entry (first in sorted history)
  const latestHistory = history[0];

  // For size and count, fall back to earlier occurrences if latest has no data
  // This ensures we show the most recent known value, not just the latest occurrence
  const latestWithSize = history.find((h) => h.size_mm !== null);
  const latestWithCount = history.find((h) => h.count !== null);

  // Get catalog info from first data row (all rows have the same catalog info)
  const firstRow = data[0] as unknown as FindingListRow;

  return {
    finding_code: firstRow.finding_code,
    finding_type_text: firstRow.finding_type_text,
    site_code: firstRow.site_code,
    body_site_text: firstRow.body_site_text,
    finding_type_id: firstRow.finding_type_id,
    body_site_id: firstRow.body_site_id,
    catalog_finding_name_ru: firstRow.finding_type_catalog?.name_ru || null,
    catalog_finding_name_en: firstRow.finding_type_catalog?.name_en || null,
    catalog_site_name_ru: firstRow.body_site_catalog?.name_ru || null,
    catalog_site_name_en: firstRow.body_site_catalog?.name_en || null,
    latest_size_mm: latestWithSize?.size_mm ?? null,
    latest_count: latestWithCount?.count ?? null,
    latest_severity: latestHistory.severity,
    latest_laterality: latestHistory.laterality,
    latest_date: latestHistory.record_date,
    is_resolved: latestHistory.resolution_status === "resolved",
    occurrence_count: data.length,
    history,
  };
}

export function useSingleFindingHistory(
  personId: string | null,
  findingCode: string | null,
  siteCode?: string,
) {
  return useQuery({
    queryKey: ["single-finding-history", personId, findingCode, siteCode],
    queryFn: () => fetchSingleFindingHistory(personId!, findingCode!, siteCode),
    enabled: !!personId && !!findingCode,
  });
}

// ============================================================================
// MARK FINDING AS RESOLVED
// Creates a new entry marked resolution_status='resolved' to indicate the finding is gone
// ============================================================================

export interface MarkResolvedInput {
  personId: string;
  recordId: string; // The record to attach the "resolved" entry to
  finding: FindingSummary;
}

async function markFindingResolved(input: MarkResolvedInput): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("record_findings")
    .insert(resolvedFindingRow(input.personId, input.recordId, input.finding));

  if (error) {
    throw new Error(error.message);
  }
}

export function useMarkFindingResolved() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markFindingResolved,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["person-finding-history", variables.personId],
      });
      queryClient.invalidateQueries({
        queryKey: ["single-finding-history"],
      });
      queryClient.invalidateQueries({
        queryKey: ["record-findings", variables.recordId],
      });
    },
  });
}
