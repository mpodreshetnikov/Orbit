import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Findings: discrete things spotted on imaging or during an exam -- polyps,
 * cysts, stones and so on -- extracted from a medical record.
 *
 * Unlike observations, `record_findings` carries its own `person_id`, so these
 * queries filter directly rather than joining through the parent record.
 *
 * A later record can close an earlier finding rather than deleting history; such a row carries
 * `resolution_status = 'resolved'`, which is surfaced here as `is_resolved`.
 */

export interface FindingRow {
  id: string;
  record_id: string;
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
  size_mm: number | null;
  count: number | null;
  severity: string;
  laterality: string;
  morphology: string | null;
  description: string | null;
  histology: string | null;
  finding_date: string | null;
  is_user_verified: boolean;
  is_resolved: boolean;
}

const FINDING_SELECT = `
  id, record_id, finding_code, finding_type_text, site_code, body_site_text,
  size_mm, count, severity, laterality, morphology, description, histology,
  finding_date, is_user_verified, resolution_status
`;

type FindingRowWithStatus = Omit<FindingRow, "is_resolved"> & { resolution_status: string };

function withResolvedFlag(rows: FindingRowWithStatus[]): FindingRow[] {
  return rows.map(({ resolution_status, ...row }) => ({
    ...row,
    is_resolved: resolution_status === "resolved",
  }));
}

export async function searchFindings(
  supabase: SupabaseClient<Database>,
  params: {
    personId: string;
    findingCode?: string;
    siteCode?: string;
    query?: string;
    severity?: string;
    laterality?: string;
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  },
): Promise<FindingRow[]> {
  let query = supabase
    .from("record_findings")
    .select(FINDING_SELECT)
    .eq("person_id", params.personId);

  if (params.findingCode) query = query.eq("finding_code", params.findingCode);
  if (params.siteCode) query = query.eq("site_code", params.siteCode);
  if (params.severity) query = query.eq("severity", params.severity);
  if (params.laterality) query = query.eq("laterality", params.laterality);
  if (params.from) query = query.gte("finding_date", params.from);
  if (params.to) query = query.lte("finding_date", params.to);

  if (params.query?.trim()) {
    const needle = params.query.trim().replace(/[,()\\]/g, " ");
    query = query.or(
      `finding_type_text.ilike.%${needle}%,body_site_text.ilike.%${needle}%,description.ilike.%${needle}%`,
    );
  }

  const { data, error } = await query
    .order("finding_date", { ascending: false, nullsFirst: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) {
    throw new Error(`Failed to search findings: ${error.message}`);
  }

  return withResolvedFlag((data ?? []) as unknown as FindingRowWithStatus[]);
}

/** All records of one finding at one site over time, oldest first. */
export async function getFindingHistory(
  supabase: SupabaseClient<Database>,
  params: { personId: string; findingCode: string; siteCode?: string; limit: number },
): Promise<FindingRow[]> {
  let query = supabase
    .from("record_findings")
    .select(FINDING_SELECT)
    .eq("person_id", params.personId)
    .eq("finding_code", params.findingCode);

  if (params.siteCode) {
    query = query.eq("site_code", params.siteCode);
  }

  const { data, error } = await query
    .order("finding_date", { ascending: true, nullsFirst: true })
    .limit(params.limit);

  if (error) {
    throw new Error(`Failed to load finding history: ${error.message}`);
  }

  return withResolvedFlag((data ?? []) as unknown as FindingRowWithStatus[]);
}
