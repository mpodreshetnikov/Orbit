"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { RecordExtractionIssue } from "@/types";

/**
 * What the extraction had to correct to keep the rest of the document.
 *
 * Read only. These rows describe what already happened to the record; a person fixes them by
 * editing the value itself on the review screen, not by editing the note about it.
 */
async function fetchRecordExtractionIssues(recordId: string): Promise<RecordExtractionIssue[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("record_extraction_issues")
    .select("id, record_id, entity_kind, field, received, resolution, applied_fallback, detail")
    .eq("record_id", recordId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as RecordExtractionIssue[];
}

export function useRecordExtractionIssues(recordId: string | null) {
  return useQuery({
    queryKey: ["record-extraction-issues", recordId],
    queryFn: () => fetchRecordExtractionIssues(recordId!),
    enabled: !!recordId,
  });
}
