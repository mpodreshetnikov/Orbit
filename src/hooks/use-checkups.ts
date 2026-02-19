"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  CheckupItem,
  CheckupCompletion,
  CreateCheckupItemInput,
  UpdateCheckupItemInput,
  CreateCheckupCompletionInput,
  UpdateCheckupCompletionInput,
  CheckupItemsFilters,
  CheckupSchedule,
  CheckupWhyLink,
} from "@/types";

// Normalize a single why_link from DB (may have missing label or different shape)
function normalizeWhyLink(link: unknown): CheckupWhyLink | null {
  if (!link || typeof link !== "object") return null;
  const o = link as Record<string, unknown>;
  const type = o.type as string | undefined;
  const id = typeof o.id === "string" ? o.id : undefined;
  if (type !== "condition" || !id) return null;
  const label = typeof o.label === "string" ? o.label : id;
  return { type: "condition", id, label };
}

// Normalize DB jsonb schedule/why_links to typed shape
function rowToCheckupItem(row: Record<string, unknown>): CheckupItem {
  const schedule = row.schedule as CheckupSchedule;
  const rawWhyLinks = row.why_links;
  const whyLinks: CheckupWhyLink[] = Array.isArray(rawWhyLinks)
    ? rawWhyLinks.map(normalizeWhyLink).filter((l): l is CheckupWhyLink => l != null)
    : [];
  const rawReminder = row.reminder_days_before;
  const reminderDaysBefore: number[] = Array.isArray(rawReminder)
    ? rawReminder.filter((x): x is number => typeof x === "number")
    : [7];
  return {
    id: row.id as string,
    person_id: row.person_id as string,
    title: row.title as string,
    category: row.category as CheckupItem["category"],
    schedule,
    next_due_at: (row.next_due_at as string | null) ?? null,
    status: row.status as CheckupItem["status"],
    reminder_days_before: reminderDaysBefore,
    planned_on: (row.planned_on as string | null) ?? null,
    why_text: (row.why_text as string | null) ?? null,
    why_links: whyLinks,
    notes: (row.notes as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToCheckupCompletion(row: Record<string, unknown>): CheckupCompletion {
  return {
    id: row.id as string,
    checkup_item_id: row.checkup_item_id as string,
    done_at: row.done_at as string,
    note: (row.note as string | null) ?? null,
    evidence_record_id: (row.evidence_record_id as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

// ============================================================================
// CHECKUP ITEMS
// ============================================================================

async function fetchCheckupItems(
  personId: string,
  filters: CheckupItemsFilters = {}
): Promise<CheckupItem[]> {
  const supabase = createClient();

  let query = supabase
    .from("checkup_items")
    .select("*")
    .eq("person_id", personId)
    .order("next_due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (filters.category) {
    query = query.eq("category", filters.category);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  let items = (data || []).map((row) => rowToCheckupItem(row));

  if (filters.dueWindow === "overdue") {
    const today = new Date().toISOString().slice(0, 10);
    items = items.filter(
      (i) => i.next_due_at != null && i.next_due_at < today && i.status === "active"
    );
  } else if (filters.dueWindow === "upcoming") {
    const today = new Date().toISOString().slice(0, 10);
    items = items.filter(
      (i) => i.next_due_at != null && i.next_due_at >= today && i.status === "active"
    );
  }

  if (filters.conditionId) {
    items = items.filter((i) =>
      i.why_links.some(
        (l) => l.type === "condition" && l.id === filters.conditionId
      )
    );
  }

  return items;
}

export function useCheckupItems(
  personId: string | null,
  filters: CheckupItemsFilters = {}
) {
  return useQuery({
    queryKey: ["checkup-items", personId, filters],
    queryFn: () => fetchCheckupItems(personId!, filters),
    enabled: !!personId,
  });
}

// ============================================================================
// SINGLE CHECKUP ITEM
// ============================================================================

async function fetchCheckupItem(itemId: string): Promise<CheckupItem | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("checkup_items")
    .select("*")
    .eq("id", itemId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }

  return data ? rowToCheckupItem(data) : null;
}

export function useCheckupItem(itemId: string | null) {
  return useQuery({
    queryKey: ["checkup-item", itemId],
    queryFn: () => fetchCheckupItem(itemId!),
    enabled: !!itemId,
  });
}

// ============================================================================
// CHECKUP COMPLETIONS
// ============================================================================

async function fetchCheckupCompletions(
  itemId: string
): Promise<CheckupCompletion[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("checkup_completions")
    .select("*")
    .eq("checkup_item_id", itemId)
    .order("done_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((row) => rowToCheckupCompletion(row));
}

export function useCheckupCompletions(itemId: string | null) {
  return useQuery({
    queryKey: ["checkup-completions", itemId],
    queryFn: () => fetchCheckupCompletions(itemId!),
    enabled: !!itemId,
  });
}

// ============================================================================
// CHECKUPS FOR CONDITION (RPC)
// ============================================================================

async function fetchCheckupsForCondition(
  conditionId: string
): Promise<CheckupItem[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("get_checkups_for_condition", {
    p_condition_id: conditionId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((row: Record<string, unknown>) => rowToCheckupItem(row));
}

export function useCheckupsForCondition(conditionId: string | null) {
  return useQuery({
    queryKey: ["checkups-for-condition", conditionId],
    queryFn: () => fetchCheckupsForCondition(conditionId!),
    enabled: !!conditionId,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

async function createCheckupItem(
  input: CreateCheckupItemInput
): Promise<CheckupItem> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("checkup_items")
    .insert({
      person_id: input.person_id,
      title: input.title,
      category: input.category,
      schedule: input.schedule as unknown as Record<string, unknown>,
      reminder_days_before: input.reminder_days_before ?? [7],
      why_text: input.why_text ?? null,
      why_links: (input.why_links ?? []) as unknown as Record<string, unknown>[],
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return rowToCheckupItem(data);
}

export function useCreateCheckupItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCheckupItem,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["checkup-items", data.person_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkups-for-condition"],
      });
    },
  });
}

async function updateCheckupItem({
  id,
  updates,
}: {
  id: string;
  updates: UpdateCheckupItemInput;
}): Promise<CheckupItem> {
  const supabase = createClient();

  const payload: Record<string, unknown> = { ...updates };
  if (updates.schedule !== undefined) {
    payload.schedule = updates.schedule as unknown as Record<string, unknown>;
  }
  if (updates.why_links !== undefined) {
    payload.why_links = updates.why_links as unknown as Record<string, unknown>[];
  }

  const { data, error } = await supabase
    .from("checkup_items")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return rowToCheckupItem(data);
}

export function useUpdateCheckupItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCheckupItem,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["checkup-item", data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkup-items", data.person_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkups-for-condition"],
      });
    },
  });
}

function toDateOnly(date: string | undefined | null): string {
  if (date && typeof date === "string" && date.trim().length > 0) {
    return date.trim().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

async function completeCheckupItem(
  input: CreateCheckupCompletionInput
): Promise<CheckupCompletion> {
  const supabase = createClient();
  const doneAt = toDateOnly(input.done_at);

  const { data, error } = await supabase
    .from("checkup_completions")
    .insert({
      checkup_item_id: input.checkup_item_id,
      done_at: doneAt,
      note: input.note ?? null,
      evidence_record_id: input.evidence_record_id ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return rowToCheckupCompletion(data);
}

export function useCompleteCheckupItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: completeCheckupItem,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["checkup-completions", data.checkup_item_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkup-item", data.checkup_item_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkup-items"],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkups-for-condition"],
      });
    },
  });
}

async function updateCheckupCompletion({
  id,
  updates,
}: {
  id: string;
  updates: UpdateCheckupCompletionInput;
}): Promise<CheckupCompletion> {
  const supabase = createClient();
  const payload: UpdateCheckupCompletionInput = { ...updates };
  if (payload.done_at !== undefined) {
    const normalized = payload.done_at?.trim().slice(0, 10);
    if (!normalized) {
      delete payload.done_at;
    } else {
      payload.done_at = normalized;
    }
  }

  const { data, error } = await supabase
    .from("checkup_completions")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return rowToCheckupCompletion(data);
}

export function useUpdateCheckupCompletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCheckupCompletion,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["checkup-completions", data.checkup_item_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkup-item", data.checkup_item_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkup-items"],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkups-for-condition"],
      });
    },
  });
}

async function deleteCheckupCompletion({
  id,
}: {
  id: string;
  checkupItemId: string;
}): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("checkup_completions")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteCheckupCompletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCheckupCompletion,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["checkup-completions", variables.checkupItemId],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkup-item", variables.checkupItemId],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkup-items"],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkups-for-condition"],
      });
    },
  });
}

async function deleteCheckupItem({
  id,
}: {
  id: string;
  personId: string;
}): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from("checkup_items").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export function useDeleteCheckupItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteCheckupItem,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["checkup-item", variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkup-items", variables.personId],
      });
      queryClient.invalidateQueries({
        queryKey: ["checkups-for-condition"],
      });
    },
  });
}
