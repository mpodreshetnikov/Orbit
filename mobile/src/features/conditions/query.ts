import type {
  Condition,
  ConditionStatus,
  ConditionWithHistory,
  IcdLookupResult,
  UpdateConditionInput,
} from "@orbit-types/condition";
import { conditionTimeline } from "@orbit-types/condition-summary";
import { supabase } from "@/lib/supabase";

/** One mention of a condition, in the record it was found in. */
export interface ConditionMention {
  id: string;
  record_id: string;
  status_in_record: ConditionStatus;
  source_anchor: string | null;
  is_llm_extracted: boolean;
  is_user_verified: boolean;
  review_decision: string | null;
  created_at: string;
  record_title: string | null;
  record_date: string | null;
  record_type: string | null;
}

/** A condition with its mentions, newest first — the web `ConditionDetail` less its closures. */
export type ConditionDetail = Condition & ReturnType<typeof conditionTimeline<ConditionMention>>;

interface MentionRow extends Omit<
  ConditionMention,
  "record_title" | "record_date" | "record_type"
> {
  medical_records: { title: string | null; record_date: string | null; record_type: string | null };
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** The person's conditions with their mention counts and dates, as the web list reads them. */
export async function fetchConditions(personId: string): Promise<ConditionWithHistory[]> {
  const rows = check(
    await supabase.rpc("get_person_conditions_with_history", { p_person_id: personId }),
  );
  return (rows ?? []) as ConditionWithHistory[];
}

/** One condition and where it was mentioned; `null` once it is deleted or never was. */
export async function fetchCondition(id: string): Promise<ConditionDetail | null> {
  const condition = check(
    await supabase.from("conditions").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
  );
  if (!condition) return null;
  const rows = check(
    await supabase
      .from("condition_records")
      .select(
        "id, record_id, status_in_record, source_anchor, is_llm_extracted, is_user_verified, " +
          "review_decision, created_at, " +
          "medical_records!inner(title, record_date, record_type)",
      )
      .eq("condition_id", id)
      .order("created_at", { ascending: false }),
  ) as unknown as MentionRow[];
  const mentions = rows.map(({ medical_records: record, ...mention }) => ({
    ...mention,
    record_title: record.title,
    record_date: record.record_date,
    record_type: record.record_type,
  }));
  return { ...(condition as Condition), ...conditionTimeline(mentions) };
}

export async function updateCondition(id: string, values: UpdateConditionInput): Promise<void> {
  check(await supabase.from("conditions").update(values).eq("id", id));
}

/** Delete as the web app does: the row stays, marked deleted. */
export async function deleteCondition(id: string): Promise<void> {
  check(
    await supabase.from("conditions").update({ deleted_at: new Date().toISOString() }).eq("id", id),
  );
}

/** An ICD-10 code's official names, from the edge function the web app asks. */
export async function lookupIcdCode(code: string): Promise<IcdLookupResult> {
  const { data, error } = await supabase.functions.invoke<IcdLookupResult>("icd-lookup", {
    body: { code },
  });
  if (error) throw new Error(error.message);
  return data as IcdLookupResult;
}
