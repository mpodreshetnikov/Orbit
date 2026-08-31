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

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function findByIcdCode(
  deps: ProposalMaterializationDeps,
  code: string,
): Promise<string | null> {
  const { data } = await deps.supabase
    .from("conditions")
    .select("id")
    .eq("person_id", deps.personId)
    .eq("code", code)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function findByName(deps: ProposalMaterializationDeps, name: string): Promise<string | null> {
  const { data } = await deps.supabase
    .from("conditions")
    .select("id")
    .eq("person_id", deps.personId)
    .ilike("name", name)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
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

  const { data } = await deps.supabase
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

    await deps.supabase
      .from("condition_records")
      .update({
        condition_id: conditionId,
        proposed_name: null,
        proposed_icd_code: null,
        is_user_verified: true,
      })
      .eq("id", proposal.id);

    materialized += 1;
  }

  return { materialized, skipped };
}
