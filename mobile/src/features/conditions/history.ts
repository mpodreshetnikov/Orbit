import type { ConditionStatus } from "@orbit-types/condition";
import { isUnverifiedClosure } from "@orbit-types/condition-closure";
import { mentionDecidesStatus } from "@orbit-types/condition-summary";
import type { RecordChoice } from "@/features/findings/query";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

/** What the web "Добавить в историю" dialog collects. */
export interface HistoryEntry {
  conditionId: string;
  conditionName: string;
  personId: string;
  status: ConditionStatus;
  /** `YYYY-MM-DD`, the day of a manual entry. */
  date: string;
  note: string;
  /** The record the entry is linked to, or none for a manual entry. */
  record: RecordChoice | null;
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Add a mention by hand, as the web dialog does: into the record picked, or into a new "Ручная
 * запись" record of that day; then, when it is the newest word the chart listens to, it sets the
 * condition's status. A closure the model wrote and nobody confirmed is not counted as newer.
 */
export async function addConditionHistory(userId: string, entry: HistoryEntry): Promise<void> {
  const note = entry.note.trim() || null;
  const manual = !entry.record;
  const record =
    entry.record ??
    (check(
      await supabase
        .from("medical_records")
        .insert({
          person_id: entry.personId,
          title: `${t("conditions.manualEntryTitle")} (${entry.conditionName})`,
          record_date: entry.date,
          record_type: "other",
          status: "active",
          notes: note,
          created_by_user_id: userId,
        })
        .select("id, title, record_date")
        .single(),
    ) as RecordChoice);
  const linked = await supabase.from("condition_records").insert({
    condition_id: entry.conditionId,
    record_id: record.id,
    status_in_record: entry.status,
    source_anchor: note,
    is_llm_extracted: false,
    is_user_verified: true,
    review_decision: "confirmed",
  });
  if (linked.error) {
    // The manual record exists only for this mention: take it back, so a retry leaves no orphan.
    if (manual) await supabase.from("medical_records").delete().eq("id", record.id);
    throw new Error(linked.error.message);
  }

  const mentions = check(
    await supabase
      .from("condition_records")
      .select("record_id, status_in_record, is_llm_extracted, is_user_verified")
      .eq("condition_id", entry.conditionId),
  ) as {
    record_id: string;
    status_in_record: string;
    is_llm_extracted: boolean;
    is_user_verified: boolean;
  }[];
  const counted = mentions.filter((mention) => !isUnverifiedClosure(mention));
  const dates = check(
    await supabase
      .from("medical_records")
      .select("record_date")
      .in(
        "id",
        counted.map((mention) => mention.record_id),
      ),
  ) as { record_date: string | null }[];
  const newest =
    dates
      .map((one) => one.record_date)
      .filter((date): date is string => date !== null)
      .sort()
      .at(-1) ?? null;

  if (mentionDecidesStatus(record.record_date, newest)) {
    check(
      await supabase
        .from("conditions")
        .update({ current_status: entry.status })
        .eq("id", entry.conditionId),
    );
  }
}
