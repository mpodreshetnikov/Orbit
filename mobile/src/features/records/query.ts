import type { RecordFindingWithCatalog } from "@orbit-types/finding";
import type {
  MedicalRecord,
  RecordAttachment,
  RecordObservationWithCatalog,
  RecordType,
} from "@orbit-types/medical-record";
import { supabase } from "@/lib/supabase";

/** Where a record's pages are kept, as the web app keeps them. */
const ATTACHMENT_BUCKET = "medical-attachments";

/** How long an attachment's link stays good: the web app's hour. */
const LINK_SECONDS = 3600;

export const RECORD_TYPES: RecordType[] = [
  "lab",
  "visit",
  "imaging",
  "prescription",
  "vaccination",
  "vet",
  "procedure",
  "other",
];

/** What the phone edits on a record: the web record page's details, nothing it extracted. */
export interface RecordDetails {
  title: string;
  record_type: RecordType;
  record_date: string | null;
  notes: string | null;
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** One read's worth of rows: the API's cap, so a longer list is read page by page. */
const PAGE = 1000;

/**
 * The person's approved documents, newest first; one without a date sorts last. All of them, page by
 * page, since the list is searched on the phone.
 */
export async function fetchRecords(personId: string): Promise<MedicalRecord[]> {
  const all: MedicalRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(
      await supabase
        .from("medical_records")
        .select("*")
        .eq("person_id", personId)
        .eq("status", "active")
        .order("record_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1),
    );
    all.push(...((rows ?? []) as MedicalRecord[]));
    if ((rows?.length ?? 0) < PAGE) return all;
  }
}

/** The web records list's search: by title, notes, summary and keywords, and by type. */
export function searchRecords(
  records: MedicalRecord[],
  query: string,
  type: RecordType | "all",
): MedicalRecord[] {
  const needle = query.trim().toLowerCase();
  return records.filter((record) => {
    if (type !== "all" && record.record_type !== type) return false;
    if (!needle) return true;
    return [record.title, record.notes, record.llm_summary, ...(record.llm_keywords ?? [])].some(
      (text) => text?.toLowerCase().includes(needle),
    );
  });
}

export async function fetchRecord(id: string): Promise<MedicalRecord | null> {
  const row = check(await supabase.from("medical_records").select("*").eq("id", id).maybeSingle());
  return (row ?? null) as MedicalRecord | null;
}

export async function fetchAttachments(recordId: string): Promise<RecordAttachment[]> {
  const rows = check(
    await supabase
      .from("record_attachments")
      .select("*")
      .eq("record_id", recordId)
      .order("sort_order", { ascending: true }),
  );
  return (rows ?? []) as RecordAttachment[];
}

/** A link to an attachment's file that opens for an hour, as the web preview's. */
export async function attachmentLink(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(storagePath, LINK_SECONDS);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function fetchRecordObservations(
  recordId: string,
): Promise<RecordObservationWithCatalog[]> {
  const rows = check(await supabase.rpc("get_record_observations", { p_record_id: recordId }));
  return (rows ?? []) as RecordObservationWithCatalog[];
}

export async function fetchRecordFindings(recordId: string): Promise<RecordFindingWithCatalog[]> {
  const rows = check(await supabase.rpc("get_record_findings", { p_record_id: recordId }));
  return (rows ?? []) as RecordFindingWithCatalog[];
}

export async function saveRecord(id: string, details: RecordDetails): Promise<void> {
  check(await supabase.from("medical_records").update(details).eq("id", id));
}
