import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Medical records: the uploaded documents (lab reports, visit notes, imaging)
 * that the OCR and structuring pipeline extracts observations, findings and
 * diagnoses from.
 */

export interface MedicalRecordSummary {
  id: string;
  person_id: string;
  title: string;
  record_type: string;
  record_date: string | null;
  status: string;
  notes: string | null;
  llm_summary: string | null;
  llm_keywords: string[] | null;
  attachment_count: number;
  search_rank?: number;
}

/**
 * Statuses that represent a finished, reviewed document. The pipeline's
 * in-progress states are noise for an agent unless it explicitly asks.
 */
export const ACTIVE_RECORD_STATUSES = ["active"];
export const ALL_RECORD_STATUSES = [
  "draft",
  "ocr_processing",
  "ocr_failed",
  "ocr_review",
  "structuring",
  "structure_review",
  "processing",
  "active",
];

/**
 * Full-text search across title, notes and OCR text, via the existing
 * `search_medical_records` RPC. That function is SECURITY DEFINER and re-checks
 * the allowlist internally, so it needs a real user JWT -- which is exactly
 * what the MCP session bridge provides.
 */
export async function searchMedicalRecords(
  supabase: SupabaseClient<Database>,
  params: {
    query?: string;
    personId?: string;
    recordType?: string;
    statuses?: string[];
    limit: number;
    offset: number;
  },
): Promise<MedicalRecordSummary[]> {
  const { data, error } = await supabase.rpc("search_medical_records", {
    search_query: params.query?.trim() || undefined,
    p_person_id: params.personId || undefined,
    p_record_type: (params.recordType as never) || undefined,
    p_limit: params.limit,
    p_offset: params.offset,
    p_statuses: params.statuses ?? ACTIVE_RECORD_STATUSES,
  });

  if (error) {
    throw new Error(`Failed to search medical records: ${error.message}`);
  }

  return (data ?? []) as unknown as MedicalRecordSummary[];
}

export async function getMedicalRecord(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("medical_records")
    .select(
      `id, person_id, title, record_type, record_date, status, notes,
       llm_summary, llm_keywords, ocr_text, created_at, updated_at,
       attachments:record_attachments ( id, original_filename, mime_type, file_size, sort_order )`,
    )
    .eq("id", recordId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load medical record: ${error.message}`);
  }
  return (data as Record<string, unknown> | null) ?? null;
}

export async function getRecordObservations(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.rpc("get_record_observations", {
    p_record_id: recordId,
  });

  if (error) {
    throw new Error(`Failed to load record observations: ${error.message}`);
  }
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

export async function getRecordFindings(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.rpc("get_record_findings", {
    p_record_id: recordId,
  });

  if (error) {
    throw new Error(`Failed to load record findings: ${error.message}`);
  }
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

export async function getRecordConditions(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.rpc("get_record_conditions", {
    p_record_id: recordId,
  });

  if (error) {
    throw new Error(`Failed to load record diagnoses: ${error.message}`);
  }
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}
