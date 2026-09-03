import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isAwaitingClosureReview, isUnverifiedClosure } from "@/lib/conditions/unverified-closure";

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
       is_llm_extracted, supporting_obs_code, review_decision,
       medical_records ( id, title, record_date, record_type )`,
    )
    .eq("condition_id", conditionId);

  // Screening scheduled because of this diagnosis.
  const { data: checkups } = await supabase.rpc("get_checkups_for_condition", {
    p_condition_id: conditionId,
  });

  return {
    condition: condition as unknown as ConditionRow,
    mentions: (mentions ?? []).map(markUnconfirmedClosure),
    checkups: (checkups ?? []) as unknown as Array<Record<string, unknown>>,
  };
}

/**
 * Say, in the row itself, that a closure is waiting on a person.
 *
 * An assistant reading these rows sees `status_in_record: "resolved"` and reports the condition as
 * resolved. It is not: the chart deliberately ignores a machine-authored closure nobody confirmed,
 * which is why the condition's own `current_status` still says active. Two fields that disagree,
 * with nothing naming the reason, is a worse answer than either field alone -- and "the assistant
 * reported a resolved condition as current" is the failure the product goal behind this names.
 *
 * A derived boolean rather than a caller's inference, because the alternative is every consumer
 * re-deriving the rule from three columns and one of them getting it wrong.
 */
export function markUnconfirmedClosure(mention: Record<string, unknown>): Record<string, unknown> {
  const candidate = {
    status_in_record: String(mention.status_in_record ?? ""),
    is_llm_extracted: mention.is_llm_extracted === true,
    is_user_verified: mention.is_user_verified === true,
    review_decision: (mention.review_decision as string | null | undefined) ?? null,
  };
  const suppressed = isUnverifiedClosure(candidate);
  const awaiting = isAwaitingClosureReview(candidate);

  if (!suppressed) return { ...mention, awaiting_confirmation: false };

  // Two ways a closure fails to reach the chart, and they are not the same news. One is waiting on
  // a person; the other is a person having already said no. Reporting a dismissal as "nobody has
  // confirmed it" misrepresents a decision that was made as one that is outstanding -- and both
  // still need saying, because either way the row reads `resolved` while the condition does not.
  return {
    ...mention,
    awaiting_confirmation: awaiting,
    not_applied_reason: awaiting
      ? "Proposed by document extraction and not yet confirmed by a person, so it has NOT changed this condition's status. Report the condition's current_status, not this row."
      : "A person reviewed this proposed closure and rejected it, so it has NOT changed this condition's status. Report the condition's current_status, not this row.",
  };
}
