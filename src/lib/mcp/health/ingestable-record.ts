import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { noteMcpPersonFromRow } from "../audit";

/** Draft / review medical record row used by ingest and approve tools. */
export interface IngestableRecord {
  id: string;
  person_id: string;
  status: string;
  title: string;
  attachments: Array<{
    id: string;
    original_filename: string;
    storage_path: string;
    mime_type: string;
    file_size?: number | null;
  }>;
}

/**
 * Load one medical record for ingest/approve. Notes `person_id` on the MCP audit
 * scope when called inside a tool invocation (no-op outside that scope).
 */
export async function getIngestableRecord(
  supabase: SupabaseClient<Database>,
  recordId: string,
): Promise<IngestableRecord | null> {
  const { data, error } = await supabase
    .from("medical_records")
    .select(
      "id, person_id, status, title, attachments:record_attachments ( id, original_filename, storage_path, mime_type, file_size )",
    )
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the record: ${error.message}`);
  const record = (data as unknown as IngestableRecord | null) ?? null;
  noteMcpPersonFromRow(record);
  return record;
}
