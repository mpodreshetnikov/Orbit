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
// FETCH RECORDS LIST
// ============================================================================
async function fetchMedicalRecords(
  filters: MedicalRecordFilters
): Promise<MedicalRecordListItem[]> {
  const supabase = createClient();

  // Build the query
  let query = supabase
    .from("medical_records")
    .select(
      `
      *,
      attachment_count:record_attachments(count)
    `
    )
    .order("record_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  // Apply filters
  if (filters.person_id) {
    query = query.eq("person_id", filters.person_id);
  }

  if (filters.record_type) {
    query = query.eq("record_type", filters.record_type);
  }

  if (filters.status) {
    query = query.eq("status", filters.status);
  } else {
    // Default: show only active records (not drafts or removed)
    query = query.eq("status", "active");
  }

  // For search, use ilike for simple substring matching on title and notes
  // This is more user-friendly than full-text search for partial matches
  if (filters.search && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    query = query.or(`title.ilike.${searchTerm},notes.ilike.${searchTerm}`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  // Transform the count from the nested structure
  return (data || []).map((record) => ({
    ...record,
    attachment_count:
      (record.attachment_count as unknown as { count: number }[])?.[0]?.count ||
      0,
  })) as MedicalRecordListItem[];
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
