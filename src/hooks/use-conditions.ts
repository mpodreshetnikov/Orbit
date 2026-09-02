"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import { AUTHORITATIVE_STATUS_FILTER } from "@/lib/conditions/unverified-closure";
import type {
  Condition,
  ConditionRecord,
  ConditionRecordWithDetails,
  ConditionWithHistory,
  CreateConditionInput,
  UpdateConditionInput,
  CreateConditionRecordInput,
  UpdateConditionRecordInput,
  ConditionStatus,
} from "@/types";

// ============================================================================
// CONDITION HOOKS (the persistent entity)
// ============================================================================

// Fetch all conditions for a person
async function fetchPersonConditions(personId: string): Promise<Condition[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("conditions")
    .select("*")
    .eq("person_id", personId)
    .is("deleted_at", null)
    .order("name");

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as Condition[];
}

export function usePersonConditions(personId: string | null) {
  return useQuery({
    queryKey: ["conditions", "person", personId],
    queryFn: () => fetchPersonConditions(personId!),
    enabled: !!personId,
  });
}

// Fetch all conditions for a person with history (using helper function)
async function fetchPersonConditionsWithHistory(personId: string): Promise<ConditionWithHistory[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("get_person_conditions_with_history", {
    p_person_id: personId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ConditionWithHistory[];
}

export function usePersonConditionsWithHistory(personId: string | null) {
  return useQuery({
    queryKey: ["conditions", "person", personId, "with-history"],
    queryFn: () => fetchPersonConditionsWithHistory(personId!),
    enabled: !!personId,
  });
}

// Fetch a single condition by ID with its full history
interface ConditionHistoryRecord {
  id: string;
  record_id: string;
  status_in_record: string;
  source_anchor: string | null;
  confidence: number | null;
  is_llm_extracted: boolean;
  is_user_verified: boolean;
  created_at: string;
  record_title: string | null;
  record_date: string | null;
  record_type: string | null;
}

export interface ConditionDetail extends Condition {
  history: ConditionHistoryRecord[];
  mention_count: number;
  first_mentioned_date: string | null;
  last_mentioned_date: string | null;
}

async function fetchConditionDetail(conditionId: string): Promise<ConditionDetail | null> {
  const supabase = createClient();

  // Fetch condition
  const { data: condition, error: condError } = await supabase
    .from("conditions")
    .select("*")
    .eq("id", conditionId)
    .is("deleted_at", null)
    .single();

  if (condError || !condition) {
    return null;
  }

  // Fetch condition records with medical record info
  const { data: records, error: recError } = await supabase
    .from("condition_records")
    .select(
      `
      id,
      record_id,
      status_in_record,
      source_anchor,
      confidence,
      is_llm_extracted,
      is_user_verified,
      created_at,
      medical_records!inner (
        title,
        record_date,
        record_type
      )
    `,
    )
    .eq("condition_id", conditionId)
    .order("created_at", { ascending: false });

  if (recError) {
    throw new Error(recError.message);
  }

  // Transform the records to include record info
  const mapped: ConditionHistoryRecord[] = (records || []).map((r) => {
    const medRec = r.medical_records as {
      title?: string;
      record_date?: string;
      record_type?: string;
    } | null;
    return {
      id: r.id as string,
      record_id: r.record_id as string,
      status_in_record: r.status_in_record as string,
      source_anchor: r.source_anchor as string | null,
      confidence: r.confidence as number | null,
      is_llm_extracted: r.is_llm_extracted as boolean,
      is_user_verified: r.is_user_verified as boolean,
      created_at: r.created_at as string,
      record_title: medRec?.title || null,
      record_date: medRec?.record_date || null,
      record_type: medRec?.record_type || null,
    };
  });

  // Sort history by record_date (timeline order: newest first; null dates last)
  const history = [...mapped].sort((a, b) => {
    const dateA = a.record_date || a.created_at?.slice(0, 10) || "";
    const dateB = b.record_date || b.created_at?.slice(0, 10) || "";
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB.localeCompare(dateA); // descending (newest first)
  });

  // Calculate stats
  const dates = history
    .map((h) => h.record_date)
    .filter((d): d is string => d !== null)
    .sort();

  return {
    ...condition,
    history,
    mention_count: history.length,
    first_mentioned_date: dates[0] || null,
    last_mentioned_date: dates[dates.length - 1] || null,
  } as ConditionDetail;
}

export function useConditionDetail(conditionId: string | null) {
  return useQuery({
    queryKey: ["condition", conditionId],
    queryFn: () => fetchConditionDetail(conditionId!),
    enabled: !!conditionId,
  });
}

// Create a new condition
async function createCondition(input: CreateConditionInput): Promise<Condition> {
  const supabase = createClient();

  const { data, error } = await supabase.from("conditions").insert(input).select().single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Condition;
}

export function useCreateCondition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCondition,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["conditions", "person", data.person_id],
      });
    },
  });
}

// Update a condition
async function updateCondition({
  id,
  updates,
}: {
  id: string;
  updates: UpdateConditionInput;
}): Promise<Condition> {
  const supabase = createClient();

  // Perform update first
  const { error: updateError } = await supabase.from("conditions").update(updates).eq("id", id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  // Then fetch the updated record separately
  const { data, error: selectError } = await supabase
    .from("conditions")
    .select()
    .eq("id", id)
    .single();

  if (selectError) {
    throw new Error(selectError.message);
  }

  return data as Condition;
}

export function useUpdateCondition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCondition,
    onSuccess: (data) => {
      // Invalidate the single condition detail query
      queryClient.invalidateQueries({
        queryKey: ["condition", data.id],
      });
      // Invalidate the person's conditions list
      queryClient.invalidateQueries({
        queryKey: ["conditions", "person", data.person_id],
      });
      // Invalidate any conditions lists
      queryClient.invalidateQueries({
        queryKey: ["conditions"],
      });
    },
  });
}

// Soft delete a condition
async function deleteCondition({ id }: { id: string; personId: string }): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("conditions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteCondition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCondition,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["conditions", "person", variables.personId],
      });
    },
  });
}

// ============================================================================
// CONDITION RECORD HISTORY (for New/Known comparison)
// ============================================================================

/** Map condition_id -> record_ids from active medical records (for comparison: exclude current record to get previous count) */
export async function fetchPersonConditionRecordHistory(
  personId: string,
): Promise<Record<string, string[]>> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("condition_records")
    .select("condition_id, record_id, conditions!inner(person_id), medical_records!inner(status)")
    .eq("conditions.person_id", personId)
    .eq("medical_records.status", "active");

  if (error) {
    throw new Error(error.message);
  }

  const map: Record<string, string[]> = {};
  for (const row of data || []) {
    const r = row as { condition_id: string; record_id: string };
    if (!map[r.condition_id]) map[r.condition_id] = [];
    map[r.condition_id].push(r.record_id);
  }
  return map;
}

export function usePersonConditionRecordHistory(personId: string | null) {
  return useQuery({
    queryKey: ["condition-record-history", "person", personId],
    queryFn: () => fetchPersonConditionRecordHistory(personId!),
    enabled: !!personId,
  });
}

// ============================================================================
// CONDITION_RECORD HOOKS (mentions in records)
// ============================================================================

// Fetch condition records for a specific medical record
async function fetchRecordConditions(recordId: string): Promise<ConditionRecordWithDetails[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("get_record_conditions", {
    p_record_id: recordId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ConditionRecordWithDetails[];
}

export function useRecordConditions(recordId: string | null) {
  return useQuery({
    queryKey: ["condition-records", "record", recordId],
    queryFn: () => fetchRecordConditions(recordId!),
    enabled: !!recordId,
  });
}

// Create a condition record
async function createConditionRecord(input: CreateConditionRecordInput): Promise<ConditionRecord> {
  const supabase = createClient();

  const { data, error } = await supabase.from("condition_records").insert(input).select().single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ConditionRecord;
}

export function useCreateConditionRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createConditionRecord,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["condition-records", "record", data.record_id],
      });
    },
  });
}

// Update a condition record
// If status_in_record changes and this is the most recent mention, auto-updates condition's current_status
// Can also update condition's ICD code if provided
async function updateConditionRecord({
  id,
  updates,
  conditionId,
  code,
  icd_name_en,
}: {
  id: string;
  updates: UpdateConditionRecordInput;
  recordId?: string;
  conditionId?: string;
  // Optional: update condition's ICD code
  code?: string | null;
  icd_name_en?: string | null;
}): Promise<ConditionRecord> {
  const supabase = createClient();

  // Perform update first
  const { error: updateError } = await supabase
    .from("condition_records")
    .update(updates)
    .eq("id", id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  // Then fetch the updated record separately
  const { data, error: selectError } = await supabase
    .from("condition_records")
    .select()
    .eq("id", id)
    .single();

  if (selectError) {
    throw new Error(selectError.message);
  }

  const conditionRecord = data as ConditionRecord;

  // When status_in_record changed, recompute condition's current_status from history
  // (status of the most recent mention by record_date). This avoids leaving a condition
  // "resolved" when the user edits the only resolved history entry to suspected/active.
  // A verification is a recompute trigger in its own right, not only a status edit. A closure the
  // model wrote is suppressed until someone confirms it, and confirming is exactly what activating
  // a record does -- `verifyAllConditions` sets `is_user_verified` and passes no status and no
  // condition id. Without this the approved closure would never reach the condition, which is the
  // failure the suppression would otherwise cause rather than prevent. The condition id comes off
  // the row we just read, since the caller need not have supplied one.
  const linkedConditionId = conditionId ?? (conditionRecord.condition_id as string | null);
  const verificationConfirmed = updates.is_user_verified === true;

  if ((updates.status_in_record || verificationConfirmed) && linkedConditionId) {
    await recomputeConditionCurrentStatus(supabase, linkedConditionId);
    const conditionUpdates: Record<string, string | null> = {};
    if (code !== undefined) {
      conditionUpdates.code = code;
      conditionUpdates.icd_name_en = icd_name_en ?? null;
    }
    if (Object.keys(conditionUpdates).length > 0) {
      await supabase.from("conditions").update(conditionUpdates).eq("id", linkedConditionId);
    }
  }

  // Update only ICD code when status didn't change (conditionId provided, no status_in_record)
  if (code !== undefined && conditionId && !updates.status_in_record) {
    await supabase
      .from("conditions")
      .update({ code, icd_name_en: icd_name_en ?? null })
      .eq("id", conditionId);
  }

  return conditionRecord;
}

export function useUpdateConditionRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateConditionRecord,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["condition-records", "record", data.record_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["conditions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["condition", data.condition_id],
      });
    },
  });
}

// Recompute condition's current_status from the most recent condition_record by record_date,
// ignoring machine-authored closures nobody has confirmed -- see AUTHORITATIVE_STATUS_FILTER.
async function recomputeConditionCurrentStatus(
  supabase: ReturnType<typeof createClient>,
  conditionId: string,
): Promise<void> {
  // Both errors are raised rather than discarded, because a verification now depends on this
  // running. The mention is already marked verified by the time we get here, and
  // `verifyAllConditions` only ever revisits unverified rows -- so a swallowed failure would
  // report success, never be retried, and leave an approved closure that never reaches the chart.
  const { data: latestMention, error: selectError } = await supabase
    .from("condition_records")
    .select("status_in_record, medical_records!inner(record_date)")
    .eq("condition_id", conditionId)
    .or(AUTHORITATIVE_STATUS_FILTER)
    .order("medical_records(record_date)", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) throw new Error(selectError.message);

  const derivedStatus = latestMention?.status_in_record;
  if (derivedStatus) {
    const { error: updateError } = await supabase
      .from("conditions")
      .update({ current_status: derivedStatus })
      .eq("id", conditionId);
    if (updateError) throw new Error(updateError.message);
  }
}

// Delete a condition record; recomputes condition's current_status from remaining history
async function deleteConditionRecord({
  id,
}: {
  id: string;
  recordId: string;
}): Promise<{ conditionId: string | null }> {
  const supabase = createClient();

  const { data: row, error: fetchError } = await supabase
    .from("condition_records")
    .select("condition_id")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    const { error } = await supabase.from("condition_records").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return { conditionId: null };
  }

  const conditionId = row.condition_id as string;

  const { error } = await supabase.from("condition_records").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  await recomputeConditionCurrentStatus(supabase, conditionId);
  return { conditionId };
}

export function useDeleteConditionRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteConditionRecord,
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["condition-records", "record", variables.recordId],
      });
      queryClient.invalidateQueries({
        queryKey: ["conditions"],
      });
      if (result.conditionId) {
        queryClient.invalidateQueries({
          queryKey: ["condition", result.conditionId],
        });
      }
    },
  });
}

// ============================================================================
// COMBINED HOOKS
// ============================================================================

// Create condition + condition_record in one operation (for manual add during review)
export function useCreateConditionWithRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      person_id: string;
      record_id: string;
      name: string;
      code?: string | null;
      icd_name_en?: string | null;
      icd_name_ru?: string | null;
      status: ConditionStatus;
      source_anchor?: string;
    }) => {
      const supabase = createClient();

      // 1. Create condition with ICD info
      const { data: condition, error: condError } = await supabase
        .from("conditions")
        .insert({
          person_id: input.person_id,
          name: input.name,
          code: input.code || null,
          icd_name_en: input.icd_name_en || null,
          icd_name_ru: input.icd_name_ru || null,
          current_status: input.status,
        })
        .select()
        .single();

      if (condError) {
        throw new Error(condError.message);
      }

      // 2. Create condition_record
      const { error: crError } = await supabase.from("condition_records").insert({
        condition_id: condition.id,
        record_id: input.record_id,
        status_in_record: input.status,
        source_anchor: input.source_anchor || null,
        is_llm_extracted: false,
        is_user_verified: true,
      });

      if (crError) {
        throw new Error(crError.message);
      }

      return { condition: condition as Condition, record_id: input.record_id };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["conditions", "person", data.condition.person_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["condition-records", "record", data.record_id],
      });
    },
  });
}

// Link existing condition to a record (create condition_record for existing condition)
// Automatically updates condition's current_status if this record is the most recent mention
// Can also update condition's ICD code if provided
export function useLinkConditionToRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      condition_id: string;
      record_id: string;
      status_in_record: ConditionStatus;
      source_anchor?: string;
      // Optional: update condition's ICD code
      code?: string | null;
      icd_name_en?: string | null;
    }) => {
      const supabase = createClient();

      // Create condition_record
      const { data: conditionRecord, error: crError } = await supabase
        .from("condition_records")
        .insert({
          condition_id: input.condition_id,
          record_id: input.record_id,
          status_in_record: input.status_in_record,
          source_anchor: input.source_anchor || null,
          is_llm_extracted: false,
          is_user_verified: true,
        })
        .select()
        .single();

      if (crError) {
        throw new Error(crError.message);
      }

      // Get this record's date
      const { data: thisRecord } = await supabase
        .from("medical_records")
        .select("record_date")
        .eq("id", input.record_id)
        .single();

      // Get the most recent record date for this condition, counting only mentions allowed to
      // decide its status. A machine closure suppressed by AUTHORITATIVE_STATUS_FILTER must not
      // win this comparison either: it cannot set the status itself, so letting it look newest
      // would only stop the person's own confirmed mention from applying and leave the condition
      // stale until that draft is reviewed -- or for good, if it never is.
      const { data: mostRecentMention } = await supabase
        .from("condition_records")
        .select("medical_records!inner(record_date)")
        .eq("condition_id", input.condition_id)
        .or(AUTHORITATIVE_STATUS_FILTER)
        .order("medical_records(record_date)", { ascending: false })
        .limit(1)
        .single();

      const thisRecordDate = thisRecord?.record_date ?? null;
      const linkMedicalRecords = mostRecentMention?.medical_records as {
        record_date?: string;
      } | null;
      const mostRecentDate = linkMedicalRecords?.record_date ?? null;

      // Only update condition current_status when this record is the most recent by date.
      // If this record has no date, or its date is before the latest mention, leave condition status unchanged.
      const shouldUpdateStatus =
        thisRecordDate != null && (!mostRecentDate || thisRecordDate >= mostRecentDate);

      // Build update object for condition
      const conditionUpdates: Record<string, string | null> = {};
      if (shouldUpdateStatus) {
        conditionUpdates.current_status = input.status_in_record;
      }
      // Add ICD code if provided
      if (input.code) {
        conditionUpdates.code = input.code;
        conditionUpdates.icd_name_en = input.icd_name_en || null;
      }

      // Update condition if there are changes
      if (Object.keys(conditionUpdates).length > 0) {
        await supabase.from("conditions").update(conditionUpdates).eq("id", input.condition_id);
      }

      return conditionRecord as ConditionRecord;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["condition-records", "record", data.record_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["conditions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["condition", data.condition_id],
      });
    },
  });
}
