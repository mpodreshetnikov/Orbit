import type { CheckupCategory, CheckupItem } from "@orbit-types/checkup";
import { rowToCheckupItem } from "@orbit-types/checkup-summary";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** "Анализы", "Визит": the web `checkups.category…` keys. */
export function categoryLabel(category: CheckupCategory): string {
  return t(`checkups.category${category.charAt(0).toUpperCase()}${category.slice(1)}`);
}

/** The person's checkups, soonest due first, as the web page reads them. */
export async function fetchCheckups(personId: string): Promise<CheckupItem[]> {
  const rows = check(
    await supabase
      .from("checkup_items")
      .select("*")
      .eq("person_id", personId)
      .order("next_due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ) as Record<string, unknown>[];
  return rows.map(rowToCheckupItem);
}

/** What the web "Отметить выполненным" dialog collects. */
export interface Completion {
  done_at: string;
  note: string;
  evidence_record_id: string | null;
}

/**
 * A checkup done, as the web dialog records it: a completion (the database moves the next due date
 * from it), and the day it was planned for cleared.
 */
export async function completeCheckup(item: CheckupItem, completion: Completion): Promise<void> {
  check(
    await supabase.from("checkup_completions").insert({
      checkup_item_id: item.id,
      done_at: completion.done_at,
      note: completion.note.trim() || null,
      evidence_record_id: completion.evidence_record_id,
    }),
  );
  if (item.planned_on) await planCheckup(item.id, null);
}

/** The day a checkup is planned for, or none. */
export async function planCheckup(id: string, plannedOn: string | null): Promise<void> {
  check(await supabase.from("checkup_items").update({ planned_on: plannedOn }).eq("id", id));
}
