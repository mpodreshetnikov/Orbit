"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  FindingSummary,
  FindingHistoryPoint,
  FindingSeverity,
  FindingLaterality,
  CreateRecordFindingInput,
} from "@/types";

// Helper to determine if a finding is resolved (size=0 or count=0)
function isResolved(size: number | null, count: number | null): boolean {
  return size === 0 || count === 0;
}

// ============================================================================
// FETCH ALL FINDINGS FOR A PERSON (aggregated by finding_code + site_code)
// ============================================================================

interface RawFindingRow {
  id: string;
  record_id: string;
  finding_type_id: string | null;
  finding_code: string | null;
  finding_type_text: string;
  body_site_id: string | null;
  site_code: string | null;
  body_site_text: string | null;
  size_mm: number | null;
  count: number | null;
  severity: string;
  laterality: string;
  morphology: string | null;
  description: string | null;
  histology: string | null;
  source_anchor: string;
  created_at: string;
  medical_records: {
    person_id: string;
    record_date: string | null;
    status: string;
  };
  finding_type_catalog: {
    name_ru: string | null;
    name_en: string | null;
  } | null;
  body_site_catalog: {
    name_ru: string | null;
    name_en: string | null;
  } | null;
}

async function fetchPersonFindingHistory(
  personId: string,
  search?: string
): Promise<FindingSummary[]> {
  const supabase = createClient();

  // Fetch all findings for active records of this person (history baseline)
  const { data, error } = await supabase
    .from("record_findings")
    .select(`
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
    `)
    .eq("medical_records.person_id", personId)
    .eq("medical_records.status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Group by finding_code + site_code (or finding_type_text + body_site_text for unrecognized)
  const findingMap = new Map<string, {
    rows: RawFindingRow[];
    history: FindingHistoryPoint[];
  }>();

  for (const row of data as unknown[]) {
    const r = row as RawFindingRow;
    
    // Create a unique key for grouping
    const findingKey = r.finding_code || r.finding_type_text.toLowerCase().trim();
    const siteKey = r.site_code || (r.body_site_text?.toLowerCase().trim() || "unknown");
    const key = `${findingKey}::${siteKey}`;

    const historyPoint: FindingHistoryPoint = {
      id: r.id,
      record_id: r.record_id,
      record_date: r.medical_records.record_date,
      size_mm: r.size_mm,
      count: r.count,
      severity: r.severity as FindingSeverity,
      laterality: r.laterality as FindingLaterality,
      morphology: r.morphology,
      description: r.description,
      histology: r.histology,
      source_anchor: r.source_anchor,
      created_at: r.created_at,
    };

    if (findingMap.has(key)) {
      const existing = findingMap.get(key)!;
      existing.rows.push(r);
      existing.history.push(historyPoint);
    } else {
      findingMap.set(key, {
        rows: [r],
        history: [historyPoint],
      });
    }
  }

  // Convert map to array, sort history, and compute latest values
  let summaries: FindingSummary[] = Array.from(findingMap.values()).map(({ rows, history }) => {
    // Sort history by date (newest first for display)
    history.sort((a, b) => {
      const dateA = a.record_date || a.created_at;
      const dateB = b.record_date || b.created_at;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    // Latest values come from the most recent entry (first in sorted history)
    const latest = history[0];
    const firstRow = rows[0]; // For catalog info

    // For size and count, fall back to earlier occurrences if latest has no data
    // This ensures we show the most recent known value, not just the latest occurrence
    const latestWithSize = history.find(h => h.size_mm !== null);
    const latestWithCount = history.find(h => h.count !== null);

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
      latest_severity: latest.severity,
      latest_laterality: latest.laterality,
      latest_date: latest.record_date,
      is_resolved: isResolved(latest.size_mm, latest.count),
      occurrence_count: history.length,
      history,
    };
  });

  // Apply search filter if provided
  if (search && search.trim()) {
    const searchLower = search.toLowerCase().trim();
    summaries = summaries.filter(s => {
      if (s.finding_type_text.toLowerCase().includes(searchLower)) return true;
      if (s.body_site_text?.toLowerCase().includes(searchLower)) return true;
      if (s.finding_code?.toLowerCase().includes(searchLower)) return true;
      if (s.site_code?.toLowerCase().includes(searchLower)) return true;
      if (s.catalog_finding_name_ru?.toLowerCase().includes(searchLower)) return true;
      if (s.catalog_finding_name_en?.toLowerCase().includes(searchLower)) return true;
      if (s.catalog_site_name_ru?.toLowerCase().includes(searchLower)) return true;
      if (s.catalog_site_name_en?.toLowerCase().includes(searchLower)) return true;
      return false;
    });
  }

  // Sort: severe findings first, then by most recent date
  summaries.sort((a, b) => {
    // Severity priority: severe > moderate > unknown > mild
    const severityOrder: Record<FindingSeverity, number> = {
      severe: 0,
      moderate: 1,
      unknown: 2,
      mild: 3,
    };
    
    const severityDiff = severityOrder[a.latest_severity] - severityOrder[b.latest_severity];
    if (severityDiff !== 0) return severityDiff;
    
    // Then by date (most recent first)
    const dateA = a.latest_date ? new Date(a.latest_date).getTime() : 0;
    const dateB = b.latest_date ? new Date(b.latest_date).getTime() : 0;
    return dateB - dateA;
  });

  return summaries;
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
  siteCode?: string
): Promise<FindingSummary | null> {
  const supabase = createClient();

  // Build query
  let query = supabase
    .from("record_findings")
    .select(`
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
    `)
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
    const row = r as RawFindingRow;
    return {
      id: row.id,
      record_id: row.record_id,
      record_date: row.medical_records.record_date,
      size_mm: row.size_mm,
      count: row.count,
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
  const latestWithSize = history.find(h => h.size_mm !== null);
  const latestWithCount = history.find(h => h.count !== null);
  
  // Get catalog info from first data row (all rows have the same catalog info)
  const firstRow = data[0] as unknown as RawFindingRow;

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
    is_resolved: isResolved(latestHistory.size_mm, latestHistory.count),
    occurrence_count: data.length,
    history,
  };
}

export function useSingleFindingHistory(
  personId: string | null, 
  findingCode: string | null,
  siteCode?: string
) {
  return useQuery({
    queryKey: ["single-finding-history", personId, findingCode, siteCode],
    queryFn: () => fetchSingleFindingHistory(personId!, findingCode!, siteCode),
    enabled: !!personId && !!findingCode,
  });
}

// ============================================================================
// MARK FINDING AS RESOLVED
// Creates a new entry with size=0, count=0 to indicate the finding is gone
// ============================================================================

interface MarkResolvedInput {
  personId: string;
  recordId: string; // The record to attach the "resolved" entry to
  finding: FindingSummary;
}

async function markFindingResolved(input: MarkResolvedInput): Promise<void> {
  const supabase = createClient();

  const newFinding: CreateRecordFindingInput = {
    person_id: input.personId,
    record_id: input.recordId,
    finding_type_id: input.finding.finding_type_id,
    finding_code: input.finding.finding_code,
    finding_type_text: input.finding.finding_type_text,
    body_site_id: input.finding.body_site_id,
    site_code: input.finding.site_code,
    body_site_text: input.finding.body_site_text,
    size_mm: 0,
    count: 0,
    severity: "unknown",
    laterality: input.finding.latest_laterality,
    source_anchor: "Marked as resolved by user",
    is_llm_extracted: false,
    is_user_verified: true,
  };

  const { error } = await supabase
    .from("record_findings")
    .insert(newFinding);

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
