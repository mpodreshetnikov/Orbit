"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  RecordObservation,
  RecordObservationWithCatalog,
  CreateRecordObservationInput,
  UpdateRecordObservationInput,
} from "@/types";

// ============================================================================
// FETCH OBSERVATIONS FOR A RECORD (with catalog details)
// ============================================================================
async function fetchRecordObservations(recordId: string): Promise<RecordObservationWithCatalog[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("get_record_observations", {
    p_record_id: recordId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as RecordObservationWithCatalog[];
}

export function useRecordObservations(recordId: string | null) {
  return useQuery({
    queryKey: ["record-observations", recordId],
    queryFn: () => fetchRecordObservations(recordId!),
    enabled: !!recordId,
  });
}

// ============================================================================
// CREATE OBSERVATION
// ============================================================================
async function createObservation(input: CreateRecordObservationInput): Promise<RecordObservation> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("record_observations")
    .insert(input)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as RecordObservation;
}

export function useCreateRecordObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createObservation,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["record-observations", data.record_id],
      });
    },
  });
}

// ============================================================================
// CREATE MULTIPLE OBSERVATIONS (batch insert)
// ============================================================================
async function createObservations(
  inputs: CreateRecordObservationInput[],
): Promise<RecordObservation[]> {
  if (inputs.length === 0) return [];

  const supabase = createClient();

  const { data, error } = await supabase.from("record_observations").insert(inputs).select();

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as RecordObservation[];
}

export function useCreateRecordObservations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createObservations,
    onSuccess: (data) => {
      if (data.length > 0) {
        queryClient.invalidateQueries({
          queryKey: ["record-observations", data[0].record_id],
        });
      }
    },
  });
}

// ============================================================================
// UPDATE OBSERVATION
// ============================================================================
async function updateObservation({
  id,
  updates,
}: {
  id: string;
  updates: UpdateRecordObservationInput;
}): Promise<RecordObservation> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("record_observations")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as RecordObservation;
}

export function useUpdateRecordObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateObservation,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["record-observations", data.record_id],
      });
    },
  });
}

// ============================================================================
// DELETE OBSERVATION
// ============================================================================
async function deleteObservation({ id }: { id: string; recordId: string }): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from("record_observations").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteRecordObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteObservation,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["record-observations", variables.recordId],
      });
    },
  });
}

// ============================================================================
// DELETE ALL OBSERVATIONS FOR A RECORD (for re-extraction)
// ============================================================================
async function deleteAllObservations(recordId: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from("record_observations").delete().eq("record_id", recordId);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteAllRecordObservations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAllObservations,
    onSuccess: (_, recordId) => {
      queryClient.invalidateQueries({
        queryKey: ["record-observations", recordId],
      });
    },
  });
}

// ============================================================================
// MARK OBSERVATION AS VERIFIED
// ============================================================================
export function useVerifyRecordObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, recordId }: { id: string; recordId: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("record_observations")
        .update({ is_user_verified: true })
        .eq("id", id);

      if (error) throw new Error(error.message);
      return { id, recordId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["record-observations", data.recordId],
      });
    },
  });
}
