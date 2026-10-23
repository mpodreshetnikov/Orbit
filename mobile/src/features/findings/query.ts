import type { FindingSummary } from "@orbit-types/finding";
import {
  FINDING_LIST_SELECT,
  resolvedFindingRow,
  summarizeFindings,
  type FindingListRow,
} from "@orbit-types/finding-summary";
import { supabase } from "@/lib/supabase";

/** A record a finding can be marked resolved on. */
export interface RecordChoice {
  id: string;
  title: string;
  record_date: string | null;
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** The person's findings, one summary per finding and site — the web `fetchPersonFindingHistory`. */
export async function fetchFindings(personId: string): Promise<FindingSummary[]> {
  const rows = check(
    await supabase
      .from("record_findings")
      .select(FINDING_LIST_SELECT)
      .eq("medical_records.person_id", personId)
      .eq("medical_records.status", "active")
      .order("created_at", { ascending: false }),
  );
  return summarizeFindings(rows as unknown as FindingListRow[]);
}

/** The person's active records, newest first: what a resolved finding is attached to. */
export async function fetchActiveRecords(personId: string): Promise<RecordChoice[]> {
  const rows = check(
    await supabase
      .from("medical_records")
      .select("id, title, record_date")
      .eq("person_id", personId)
      .eq("status", "active")
      .order("record_date", { ascending: false }),
  );
  return rows as RecordChoice[];
}

export async function markFindingResolved(
  personId: string,
  recordId: string,
  finding: FindingSummary,
) {
  check(
    await supabase.from("record_findings").insert(resolvedFindingRow(personId, recordId, finding)),
  );
}
