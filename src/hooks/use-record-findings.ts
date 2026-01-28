"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  RecordFinding,
  RecordFindingWithCatalog,
  CreateRecordFindingInput,
  UpdateRecordFindingInput,
} from "@/types";

// ============================================================================
// FETCH FINDINGS FOR A RECORD (with catalog details)
// ============================================================================
async function fetchRecordFindings(
  recordId: string
): Promise<RecordFindingWithCatalog[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("get_record_findings", {
    p_record_id: recordId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as RecordFindingWithCatalog[];
}

export function useRecordFindings(recordId: string | null) {
  return useQuery({
    queryKey: ["record-findings", recordId],
    queryFn: () => fetchRecordFindings(recordId!),
    enabled: !!recordId,
  });
}

// ============================================================================
// CREATE FINDING
// ============================================================================
async function createFinding(
  input: CreateRecordFindingInput
): Promise<RecordFinding> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("record_findings")
    .insert(input)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as RecordFinding;
}

export function useCreateRecordFinding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createFinding,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["record-findings", data.record_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["person-finding-history"],
      });
    },
  });
}

// ============================================================================
// CREATE MULTIPLE FINDINGS (batch insert)
// ============================================================================
async function createFindings(
  inputs: CreateRecordFindingInput[]
): Promise<RecordFinding[]> {
  if (inputs.length === 0) return [];

  const supabase = createClient();

  const { data, error } = await supabase
    .from("record_findings")
    .insert(inputs)
    .select();

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as RecordFinding[];
}

export function useCreateRecordFindings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createFindings,
    onSuccess: (data) => {
      if (data.length > 0) {
        queryClient.invalidateQueries({
          queryKey: ["record-findings", data[0].record_id],
        });
        queryClient.invalidateQueries({
          queryKey: ["person-finding-history"],
        });
      }
    },
  });
}

// ============================================================================
// UPDATE FINDING
// ============================================================================
async function updateFinding({
  id,
  updates,
}: {
  id: string;
  updates: UpdateRecordFindingInput;
}): Promise<RecordFinding> {
  const supabase = createClient();

  // Perform update first
  const { error: updateError } = await supabase
    .from("record_findings")
    .update(updates)
    .eq("id", id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  // Then fetch the updated record separately (avoids RLS issues with select after update)
  const { data, error: selectError } = await supabase
    .from("record_findings")
    .select()
    .eq("id", id)
    .single();

  if (selectError) {
    throw new Error(selectError.message);
  }

  return data as RecordFinding;
}

export function useUpdateRecordFinding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateFinding,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["record-findings", data.record_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["person-finding-history"],
      });
    },
  });
}

// ============================================================================
// DELETE FINDING
// ============================================================================
async function deleteFinding({
  id,
  recordId: _recordId,
}: {
  id: string;
  recordId: string;
}): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("record_findings")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteRecordFinding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteFinding,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["record-findings", variables.recordId],
      });
      queryClient.invalidateQueries({
        queryKey: ["person-finding-history"],
      });
    },
  });
}

// ============================================================================
// DELETE ALL FINDINGS FOR A RECORD (for re-extraction)
// ============================================================================
async function deleteAllFindings(recordId: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("record_findings")
    .delete()
    .eq("record_id", recordId);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteAllRecordFindings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAllFindings,
    onSuccess: (_, recordId) => {
      queryClient.invalidateQueries({
        queryKey: ["record-findings", recordId],
      });
      queryClient.invalidateQueries({
        queryKey: ["person-finding-history"],
      });
    },
  });
}

// ============================================================================
// MARK FINDING AS VERIFIED
// ============================================================================
export function useVerifyRecordFinding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, recordId }: { id: string; recordId: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("record_findings")
        .update({ is_user_verified: true })
        .eq("id", id);

      if (error) throw new Error(error.message);
      return { id, recordId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["record-findings", data.recordId],
      });
    },
  });
}
