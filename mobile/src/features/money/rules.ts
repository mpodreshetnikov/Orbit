import type {
  CreateMoneyCategoryRuleInput,
  MoneyCategoryRule,
  UpdateMoneyCategoryRuleInput,
} from "@orbit-types/money";
import { rowToMoneyCategoryRule } from "@orbit-types/money-rules";
import { supabase } from "@/lib/supabase";

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** The person's category rules, in the order the pipeline runs them. */
export async function fetchRules(personId: string): Promise<MoneyCategoryRule[]> {
  const rows = check(
    await supabase
      .from("money_category_rules")
      .select("*")
      .eq("person_id", personId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  );
  return (rows ?? []).map((row) => rowToMoneyCategoryRule(row as Record<string, unknown>));
}

export async function deleteRule(id: string): Promise<void> {
  check(await supabase.from("money_category_rules").delete().eq("id", id));
}

/**
 * Number the rules 1… in `ids`' order. Each first steps aside to a negative place, as the web
 * does, so that no two rules share a place on the way.
 */
export async function reorderRules(ids: string[]): Promise<void> {
  const table = () => supabase.from("money_category_rules");
  for (const [index, id] of ids.entries()) {
    check(
      await table()
        .update({ sort_order: -1000 - index })
        .eq("id", id),
    );
  }
  for (const [index, id] of ids.entries()) {
    check(
      await table()
        .update({ sort_order: index + 1 })
        .eq("id", id),
    );
  }
}

/** Add a rule (a payload with its person and place), or change one by `id`. */
export async function saveRule(
  id: string | null,
  payload: CreateMoneyCategoryRuleInput | UpdateMoneyCategoryRuleInput,
): Promise<void> {
  // The generated types want the filters and config as `Json`; the rule's own types are narrower.
  const row = payload as never;
  const table = supabase.from("money_category_rules");
  if (id) check(await table.update(row).eq("id", id));
  else check(await table.insert(row));
}
