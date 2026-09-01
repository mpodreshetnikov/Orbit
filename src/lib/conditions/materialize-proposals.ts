import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConditionRecordWithDetails, IcdLookupResult } from "@/types";

/**
 * Turning a record's condition proposals into real conditions, at activation.
 *
 * Extraction records what a document said as a proposal scoped to the record; nothing reaches
 * `public.conditions` until a person activates the record. This is where that happens, so it runs
 * on the approval path and nowhere else.
 *
 * The matching is the logic that used to live in the edge function's `resolveOrCreateCondition`:
 * an existing condition wins over creating one, by ICD code first and by name second, because the
 * chart should gain a second row for the same diagnosis only when it really is a second
 * diagnosis. What is new is provenance -- a row created here says it came from an LLM proposal
 * and that a person approved it.
 */

export interface ProposalMaterializationDeps {
  supabase: SupabaseClient;
  personId: string;
  /** Resolves an ICD-10 code to its catalogue names; null when the code is unknown. */
  lookupIcd: (code: string) => Promise<IcdLookupResult | null>;
}

export interface MaterializationOutcome {
  /** Proposals that now point at a condition. */
  materialized: number;
  /** Proposals left alone because they carried nothing to match or create on. */
  skipped: number;
}

/**
 * A write that did not land. Thrown rather than counted, because the caller must not activate a
 * record whose proposals are only half in the chart: a created condition with no mention pointing
 * at it is exactly the orphan this whole change exists to prevent.
 */
export class ProposalMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalMaterializationError";
  }
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function findByIcdCode(
  deps: ProposalMaterializationDeps,
  code: string,
): Promise<string | null> {
  const { data, error } = await deps.supabase
    .from("conditions")
    .select("id")
    .eq("person_id", deps.personId)
    .eq("code", code)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw new ProposalMaterializationError(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

async function findByName(deps: ProposalMaterializationDeps, name: string): Promise<string | null> {
  const { data, error } = await deps.supabase
    .from("conditions")
    .select("id")
    .eq("person_id", deps.personId)
    .ilike("name", name)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw new ProposalMaterializationError(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Bring a condition's current status in line with its most recent mention.
 *
 * The edge function does this for every mention it links; the activation path has to do the same
 * for a condition it reuses, or an approved `resolved` proposal leaves the chart still showing
 * the condition as active. Nothing in the database does it for us.
 */
async function recomputeCurrentStatus(
  deps: ProposalMaterializationDeps,
  conditionId: string,
): Promise<void> {
  const { data, error } = await deps.supabase
    .from("condition_records")
    .select("status_in_record, medical_records!inner(record_date)")
    .eq("condition_id", conditionId)
    .order("medical_records(record_date)", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ProposalMaterializationError(error.message);

  const status = (data as { status_in_record?: string } | null)?.status_in_record;
  if (!status) return;

  const { error: updateError } = await deps.supabase
    .from("conditions")
    .update({ current_status: status })
    .eq("id", conditionId);
  if (updateError) throw new ProposalMaterializationError(updateError.message);
}

async function resolveOrCreateCondition(
  deps: ProposalMaterializationDeps,
  proposal: { name: string; icdCode: string | null; status: string },
): Promise<string | null> {
  const icdLookup = proposal.icdCode ? await deps.lookupIcd(proposal.icdCode) : null;
  const verifiedCode = icdLookup?.found ? proposal.icdCode : null;

  if (verifiedCode) {
    const byCode = await findByIcdCode(deps, verifiedCode);
    if (byCode) return byCode;
  }

  const byName = await findByName(deps, proposal.name);
  if (byName) return byName;

  const { data, error } = await deps.supabase
    .from("conditions")
    .insert({
      person_id: deps.personId,
      name: proposal.name,
      code: verifiedCode,
      icd_name_en: icdLookup?.found ? icdLookup.name_en : null,
      icd_name_ru: icdLookup?.found ? icdLookup.name_ru : null,
      current_status: proposal.status,
      // Provenance the chart could not state before: this row came from a model's reading, and
      // it exists because a person accepted it.
      is_llm_extracted: true,
      is_user_verified: true,
    })
    .select("id")
    .single();
  if (error) throw new ProposalMaterializationError(error.message);

  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Materialise every proposal on a record. Returns what happened, so the caller can report a
 * proposal that could not be turned into anything rather than silently dropping it.
 */
export async function materializeConditionProposals(
  proposals: ConditionRecordWithDetails[],
  deps: ProposalMaterializationDeps,
): Promise<MaterializationOutcome> {
  let materialized = 0;
  let skipped = 0;

  for (const proposal of proposals) {
    if (!proposal.is_proposal) continue;

    const name = normalize(proposal.condition_name);
    if (!name) {
      skipped += 1;
      continue;
    }

    const conditionId = await resolveOrCreateCondition(deps, {
      name,
      icdCode: normalize(proposal.condition_code),
      status: proposal.status_in_record,
    });

    if (!conditionId) {
      skipped += 1;
      continue;
    }

    const { error } = await deps.supabase
      .from("condition_records")
      .update({
        condition_id: conditionId,
        proposed_name: null,
        proposed_icd_code: null,
        is_user_verified: true,
      })
      .eq("id", proposal.id);
    // A refused link -- the record already mentions this condition, say, which the
    // (condition_id, record_id) unique constraint rejects -- must stop activation rather than be
    // counted as done. Otherwise the condition exists and nothing points at it.
    if (error) throw new ProposalMaterializationError(error.message);

    // The reused or created condition now has a newer mention; its status follows from it.
    await recomputeCurrentStatus(deps, conditionId);

    materialized += 1;
  }

  return { materialized, skipped };
}
