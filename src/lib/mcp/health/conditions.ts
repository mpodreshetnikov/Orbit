import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Conditions -- the app's word for diagnoses.
 *
 * Two tables: `conditions` is the persistent per-person diagnosis (with its
 * ICD-10 code and current status), and `condition_records` records each time
 * that diagnosis was mentioned in a document. Deletion is soft, via
 * `deleted_at`.
 */

export interface ConditionRow {
  id: string;
  person_id: string;
  name: string;
  code: string | null;
  icd_name_en: string | null;
  icd_name_ru: string | null;
  current_status: string;
  onset_date: string | null;
  resolved_date: string | null;
  notes: string | null;
  first_mentioned_date?: string | null;
  last_mentioned_date?: string | null;
  mention_count?: number;
}

/** Diagnoses with their mention history, via the existing RPC. */
export async function listConditions(
  supabase: SupabaseClient<Database>,
  params: { personId: string; status?: string },
): Promise<ConditionRow[]> {
  const { data, error } = await supabase.rpc("get_person_conditions_with_history", {
    p_person_id: params.personId,
  });

  if (error) {
    throw new Error(`Failed to load diagnoses: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as ConditionRow[];
  return params.status ? rows.filter((row) => row.current_status === params.status) : rows;
}

export async function getCondition(
  supabase: SupabaseClient<Database>,
  conditionId: string,
): Promise<{
  condition: ConditionRow | null;
  mentions: Array<Record<string, unknown>>;
  checkups: Array<Record<string, unknown>>;
}> {
  const { data: condition, error } = await supabase
    .from("conditions")
    .select(
      "id, person_id, name, code, icd_name_en, icd_name_ru, current_status, onset_date, resolved_date, notes, created_at, updated_at",
    )
    .eq("id", conditionId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load diagnosis: ${error.message}`);
  }

  if (!condition) {
    return { condition: null, mentions: [], checkups: [] };
  }

  const { data: mentions } = await supabase
    .from("condition_records")
    .select(
      `id, record_id, status_in_record, source_anchor, confidence, is_user_verified,
       medical_records ( id, title, record_date, record_type )`,
    )
    .eq("condition_id", conditionId);

  // Screening scheduled because of this diagnosis.
  const { data: checkups } = await supabase.rpc("get_checkups_for_condition", {
    p_condition_id: conditionId,
  });

  return {
    condition: condition as unknown as ConditionRow,
    mentions: (mentions ?? []) as unknown as Array<Record<string, unknown>>,
    checkups: (checkups ?? []) as unknown as Array<Record<string, unknown>>,
  };
}
