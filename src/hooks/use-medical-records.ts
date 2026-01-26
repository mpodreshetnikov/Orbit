"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  MedicalRecord,
  MedicalRecordWithAttachments,
  MedicalRecordListItem,
  MedicalRecordFilters,
  CreateMedicalRecordInput,
  UpdateMedicalRecordInput,
  RecordAttachment,
  RecordStatus,
} from "@/types";

// ============================================================================
// FETCH RECORDS LIST (using RPC for full-text search)
// ============================================================================
async function fetchMedicalRecords(
  filters: MedicalRecordFilters
): Promise<MedicalRecordListItem[]> {
  const supabase = createClient();

  // Use the search_medical_records RPC function for proper FTS with ranking
  const { data, error } = await supabase.rpc("search_medical_records", {
    search_query: filters.search?.trim() || null,
    p_person_id: filters.person_id || null,
    p_record_type: filters.record_type || null,
    p_status: filters.status || "active",
    p_limit: 50,
    p_offset: 0,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as MedicalRecordListItem[];
}

export function useMedicalRecords(filters: MedicalRecordFilters = {}) {
  return useQuery({
    queryKey: ["medical-records", filters],
    queryFn: () => fetchMedicalRecords(filters),
    enabled: !!filters.person_id, // Only fetch when person is selected
  });
}

// ============================================================================
// FETCH SINGLE RECORD WITH ATTACHMENTS
// ============================================================================
async function fetchMedicalRecord(
  recordId: string
): Promise<MedicalRecordWithAttachments | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("medical_records")
    .select(
      `
      *,
      attachments:record_attachments(*)
    `
    )
    .eq("id", recordId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw new Error(error.message);
  }

  // Sort attachments by sort_order
  const attachments = (
    (data.attachments as RecordAttachment[]) || []
  ).sort((a, b) => a.sort_order - b.sort_order);

  return {
    ...data,
    attachments,
  } as MedicalRecordWithAttachments;
}

export function useMedicalRecord(recordId: string | null) {
  return useQuery({
    queryKey: ["medical-record", recordId],
    queryFn: () => fetchMedicalRecord(recordId!),
    enabled: !!recordId,
  });
}

// ============================================================================
// CREATE MEDICAL RECORD (DRAFT)
// ============================================================================
async function createMedicalRecord(
  input: CreateMedicalRecordInput
): Promise<MedicalRecord> {
  const supabase = createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("medical_records")
    .insert({
      ...input,
      created_by_user_id: user.id,
      status: input.status || "draft",
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as MedicalRecord;
}

export function useCreateMedicalRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createMedicalRecord,
    onSuccess: (data) => {
      // Invalidate records list for this person
      queryClient.invalidateQueries({
        queryKey: ["medical-records", { person_id: data.person_id }],
      });
    },
  });
}

// ============================================================================
// UPDATE MEDICAL RECORD
// ============================================================================
async function updateMedicalRecord({
  id,
  updates,
}: {
  id: string;
  updates: UpdateMedicalRecordInput;
}): Promise<MedicalRecord> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("medical_records")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as MedicalRecord;
}

export function useUpdateMedicalRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateMedicalRecord,
    onSuccess: (data) => {
      // Invalidate the single record
      queryClient.invalidateQueries({
        queryKey: ["medical-record", data.id],
      });
      // Invalidate records list for this person
      queryClient.invalidateQueries({
        queryKey: ["medical-records"],
        predicate: (query) =>
          query.queryKey[0] === "medical-records" &&
          (query.queryKey[1] as MedicalRecordFilters)?.person_id ===
            data.person_id,
      });
    },
  });
}

// ============================================================================
// SOFT DELETE (REMOVE) RECORD
// ============================================================================
async function softDeleteRecord(id: string): Promise<MedicalRecord> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("medical_records")
    .update({
      status: "removed" as RecordStatus,
      removed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as MedicalRecord;
}

export function useSoftDeleteRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: softDeleteRecord,
    onSuccess: (data) => {
      // Invalidate the single record
      queryClient.invalidateQueries({
        queryKey: ["medical-record", data.id],
      });
      // Invalidate all records lists
      queryClient.invalidateQueries({
        queryKey: ["medical-records"],
      });
    },
  });
}

// ============================================================================
// RESTORE RECORD (from removed back to active)
// ============================================================================
async function restoreRecord(id: string): Promise<MedicalRecord> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("medical_records")
    .update({
      status: "active" as RecordStatus,
      removed_at: null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as MedicalRecord;
}

export function useRestoreRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: restoreRecord,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["medical-record", data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["medical-records"],
      });
    },
  });
}

// ============================================================================
// HARD DELETE RECORD (for drafts or cleanup)
// ============================================================================
async function hardDeleteRecord(id: string): Promise<void> {
  const supabase = createClient();

  // First delete attachments from storage
  const { data: record } = await supabase
    .from("medical_records")
    .select("person_id")
    .eq("id", id)
    .single();

  if (record) {
    // Delete all files in the record's storage folder
    const folderPath = `${record.person_id}/${id}`;
    const { data: files } = await supabase.storage
      .from("medical-attachments")
      .list(folderPath);

    if (files && files.length > 0) {
      const filePaths = files.map((f) => `${folderPath}/${f.name}`);
      await supabase.storage.from("medical-attachments").remove(filePaths);
    }
  }

  // Then delete the record (attachments cascade delete)
  const { error } = await supabase
    .from("medical_records")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useHardDeleteRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: hardDeleteRecord,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["medical-records"],
      });
    },
  });
}

// ============================================================================
// INGEST RECORD (Vision OCR + LLM extraction via Edge Function)
// ============================================================================
interface IngestRecordInput {
  recordId: string;
}

interface IngestRecordResponse {
  success: boolean;
  extraction?: {
    ocr_text: string;
    record_type: string;
    title: string;
    record_date: string | null;
    summary: string;
    keywords: string[];
  };
  chunks_created?: number;
  error?: string;
}

async function ingestRecord({
  recordId,
}: IngestRecordInput): Promise<IngestRecordResponse> {
  const supabase = createClient();

  // Get current session for auth header
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not authenticated");
  }

  // Get the Supabase URL from environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("Supabase URL not configured");
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/ingest-record`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        record_id: recordId,
      }),
    });
  } catch (networkError) {
    // Network error - Edge Functions might not be running
    throw new Error(
      "Cannot connect to Edge Functions. Make sure 'supabase functions serve' is running."
    );
  }

  // Check for HTTP errors
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Edge Function error (${response.status}): ${errorText || response.statusText}`
    );
  }

  let data: IngestRecordResponse;
  try {
    data = await response.json();
  } catch {
    throw new Error("Invalid response from Edge Function");
  }

  if (!data.success) {
    throw new Error(data.error || "Ingestion failed");
  }

  return data;
}

export function useIngestRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ingestRecord,
    onSuccess: (_, variables) => {
      // Invalidate the record to refresh with extraction data
      queryClient.invalidateQueries({
        queryKey: ["medical-record", variables.recordId],
      });
    },
  });
}
