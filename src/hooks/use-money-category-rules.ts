"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callMoneyCategorizeAction } from "@/lib/money-categorize-client";
import { createClient } from "@/lib/supabase";
import type { Database, Json } from "@/types/database";
import type {
  CreateMoneyCategoryRuleInput,
  MoneyCategoryRule,
  MoneyCategoryRuleFilter,
  MoneyCategoryRuleRun,
  UpdateMoneyCategoryRuleInput,
} from "@/types";

type MoneyCategoryRuleInsert = Database["public"]["Tables"]["money_category_rules"]["Insert"];
type MoneyCategoryRuleUpdate = Database["public"]["Tables"]["money_category_rules"]["Update"];

function normalizeFilters(value: unknown): MoneyCategoryRuleFilter[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MoneyCategoryRuleFilter =>
    Boolean(item && typeof item === "object"),
  );
}

function rowToMoneyCategoryRule(row: Record<string, unknown>): MoneyCategoryRule {
  return {
    id: String(row.id),
    person_id: String(row.person_id),
    name: String(row.name ?? ""),
    description: (row.description as string | null) ?? null,
    enabled: Boolean(row.enabled),
    sort_order: Number(row.sort_order ?? 0),
    rule_kind: row.rule_kind as MoneyCategoryRule["rule_kind"],
    target_category_id: (row.target_category_id as string | null) ?? null,
    match_mode: (row.match_mode as MoneyCategoryRule["match_mode"]) ?? "all",
    scope_filter: (row.scope_filter as MoneyCategoryRule["scope_filter"]) ?? "all_line_items",
    filters: normalizeFilters(row.filters),
    config: (row.config as Record<string, unknown> | null) ?? {},
    stop_processing: Boolean(row.stop_processing),
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function asRuleStep(raw: Record<string, unknown>) {
  return {
    id: (raw.id as string | null) ?? (raw.step_id as string | null) ?? null,
    rule_id: String(raw.rule_id ?? ""),
    rule_name: (raw.rule_name as string | null) ?? null,
    rule_kind: raw.rule_kind as MoneyCategoryRule["rule_kind"],
    sort_order: Number(raw.sort_order ?? 0),
    matched: Boolean(raw.matched),
    changed_category: Boolean(raw.changed_category),
    previous_category_id: (raw.previous_category_id as string | null) ?? null,
    next_category_id: (raw.next_category_id as string | null) ?? null,
    decision_reason: String(raw.decision_reason ?? ""),
    debug_payload: (raw.debug_payload as Record<string, unknown> | null) ?? {},
    created_at: (raw.created_at as string | null) ?? null,
  };
}

export function asMoneyCategoryRuleRun(raw: Record<string, unknown>): MoneyCategoryRuleRun {
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  return {
    id: (raw.id as string | null) ?? (raw.run_id as string | null) ?? null,
    triggered_by_user_id: (raw.triggered_by_user_id as string | null) ?? null,
    person_id: String(raw.person_id ?? ""),
    trigger_source: String(raw.trigger_source ?? ""),
    line_item_id: String(raw.line_item_id ?? ""),
    line_item_title: (raw.line_item_title as string | null) ?? null,
    transaction_id: String(raw.transaction_id ?? ""),
    merchant_name: (raw.merchant_name as string | null) ?? null,
    starting_category_id: (raw.starting_category_id as string | null) ?? null,
    final_category_id: (raw.final_category_id as string | null) ?? null,
    saved: Boolean(raw.saved),
    llm_tokens_prompt: raw.llm_tokens_prompt == null ? null : Number(raw.llm_tokens_prompt),
    llm_tokens_completion:
      raw.llm_tokens_completion == null ? null : Number(raw.llm_tokens_completion),
    created_at: (raw.created_at as string | null) ?? null,
    steps: stepsRaw.map((step) => asRuleStep((step ?? {}) as Record<string, unknown>)),
  };
}

async function hasEnabledLlmRules(personId: string, ruleIds?: string[] | null): Promise<boolean> {
  const supabase = createClient();
  let query = supabase
    .from("money_category_rules")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId)
    .eq("enabled", true)
    .eq("rule_kind", "llm_categorization");

  if (ruleIds && ruleIds.length > 0) {
    query = query.in("id", ruleIds);
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

async function fetchMoneyCategoryRules(personId: string): Promise<MoneyCategoryRule[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_category_rules")
    .select("*")
    .eq("person_id", personId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToMoneyCategoryRule(row as Record<string, unknown>));
}

export function useMoneyCategoryRules(personId: string | null) {
  return useQuery({
    queryKey: ["money-category-rules", personId],
    queryFn: () => fetchMoneyCategoryRules(personId!),
    enabled: !!personId,
  });
}

async function createMoneyCategoryRule(
  input: CreateMoneyCategoryRuleInput,
): Promise<MoneyCategoryRule> {
  const supabase = createClient();
  const payload: MoneyCategoryRuleInsert = {
    person_id: input.person_id,
    name: input.name,
    description: input.description ?? null,
    enabled: input.enabled ?? true,
    sort_order: input.sort_order,
    rule_kind: input.rule_kind as MoneyCategoryRuleInsert["rule_kind"],
    target_category_id: input.target_category_id ?? null,
    match_mode: input.match_mode ?? "all",
    scope_filter: input.scope_filter ?? "all_line_items",
    filters: (input.filters ?? []) as unknown as Json,
    config: (input.config ?? {}) as Json,
    stop_processing: input.stop_processing ?? false,
  };
  const { data, error } = await supabase
    .from("money_category_rules")
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return rowToMoneyCategoryRule(data as Record<string, unknown>);
}

export function useCreateMoneyCategoryRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMoneyCategoryRule,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["money-category-rules", data.person_id] });
    },
  });
}

async function updateMoneyCategoryRule({
  id,
  updates,
}: {
  id: string;
  updates: UpdateMoneyCategoryRuleInput;
}): Promise<MoneyCategoryRule> {
  const supabase = createClient();
  const payload: MoneyCategoryRuleUpdate = {
    ...updates,
    rule_kind:
      updates.rule_kind == null
        ? undefined
        : (updates.rule_kind as MoneyCategoryRuleUpdate["rule_kind"]),
    filters: updates.filters == null ? undefined : (updates.filters as unknown as Json),
    config: updates.config == null ? undefined : (updates.config as Json),
  };
  const { data, error } = await supabase
    .from("money_category_rules")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return rowToMoneyCategoryRule(data as Record<string, unknown>);
}

export function useUpdateMoneyCategoryRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMoneyCategoryRule,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["money-category-rules", data.person_id] });
    },
  });
}

async function deleteMoneyCategoryRule({
  id,
  personId: _personId,
}: {
  id: string;
  personId: string;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("money_category_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function useDeleteMoneyCategoryRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMoneyCategoryRule,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["money-category-rules", variables.personId] });
    },
  });
}

async function reorderMoneyCategoryRules({
  personId: _personId,
  orderedRuleIds,
}: {
  personId: string;
  orderedRuleIds: string[];
}): Promise<void> {
  const supabase = createClient();

  for (let index = 0; index < orderedRuleIds.length; index += 1) {
    const { error } = await supabase
      .from("money_category_rules")
      .update({ sort_order: -1000 - index })
      .eq("id", orderedRuleIds[index]);
    if (error) throw new Error(error.message);
  }

  for (let index = 0; index < orderedRuleIds.length; index += 1) {
    const { error } = await supabase
      .from("money_category_rules")
      .update({ sort_order: index + 1 })
      .eq("id", orderedRuleIds[index]);
    if (error) throw new Error(error.message);
  }
}

export function useReorderMoneyCategoryRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reorderMoneyCategoryRules,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["money-category-rules", variables.personId] });
    },
  });
}

function asRuleRunsEnvelope(data: unknown): MoneyCategoryRuleRun[] {
  const rawRuns = Array.isArray((data as { runs?: unknown[] } | null)?.runs)
    ? (((data as { runs?: unknown[] }).runs ?? []) as unknown[])
    : [];
  return rawRuns.map((run) => asMoneyCategoryRuleRun((run ?? {}) as Record<string, unknown>));
}

async function previewMoneyCategoryRulePipeline({
  lineItemId,
  personId,
  ruleIds,
}: {
  lineItemId: string;
  personId?: string | null;
  ruleIds?: string[] | null;
}): Promise<MoneyCategoryRuleRun> {
  if (personId && (await hasEnabledLlmRules(personId, ruleIds))) {
    const data = await callMoneyCategorizeAction<Record<string, unknown>>({
      action: "preview_pipeline",
      line_item_id: lineItemId,
      person_id: personId,
      rule_ids: ruleIds ?? null,
    });
    return asMoneyCategoryRuleRun(data);
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("money_preview_category_rule_pipeline", {
    p_line_item_id: lineItemId,
    p_person_id: personId ?? undefined,
    p_rule_ids: ruleIds ?? undefined,
  });
  if (error) throw new Error(error.message);
  return asMoneyCategoryRuleRun((data ?? {}) as Record<string, unknown>);
}

export function usePreviewMoneyCategoryRulePipeline() {
  return useMutation({
    mutationFn: previewMoneyCategoryRulePipeline,
  });
}

async function applyMoneyCategoryRulePipeline({
  lineItemIds,
  personId,
  forceOverwriteLocked = false,
  triggerSource = "manual_replay",
}: {
  lineItemIds: string[];
  personId?: string | null;
  forceOverwriteLocked?: boolean;
  triggerSource?: string;
}): Promise<MoneyCategoryRuleRun[]> {
  if (personId && (await hasEnabledLlmRules(personId))) {
    const data = await callMoneyCategorizeAction<{ runs?: unknown[] }>({
      action: "apply_pipeline",
      line_item_ids: lineItemIds,
      person_id: personId,
      force_overwrite_locked: forceOverwriteLocked,
      trigger_source: triggerSource,
    });
    return asRuleRunsEnvelope(data);
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("money_apply_category_rule_pipeline", {
    p_line_item_ids: lineItemIds,
    p_person_id: personId ?? undefined,
    p_force_overwrite_locked: forceOverwriteLocked,
    p_trigger_source: triggerSource,
  });
  if (error) throw new Error(error.message);
  return asRuleRunsEnvelope(data);
}

export function useApplyMoneyCategoryRulePipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: applyMoneyCategoryRulePipeline,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["money-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["money-transaction"] });
      queryClient.invalidateQueries({ queryKey: ["money-category-debug"] });
    },
  });
}

async function replayMoneyCategoryRulePipelineForTransaction({
  transactionId,
  personId,
  forceOverwriteLocked = false,
}: {
  transactionId: string;
  personId?: string | null;
  forceOverwriteLocked?: boolean;
}): Promise<MoneyCategoryRuleRun[]> {
  if (personId && (await hasEnabledLlmRules(personId))) {
    const data = await callMoneyCategorizeAction<{ runs?: unknown[] }>({
      action: "replay_transaction",
      transaction_id: transactionId,
      person_id: personId,
      force_overwrite_locked: forceOverwriteLocked,
    });
    return asRuleRunsEnvelope(data);
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("money_apply_category_rule_pipeline_for_transaction", {
    p_transaction_id: transactionId,
    p_person_id: personId ?? undefined,
    p_force_overwrite_locked: forceOverwriteLocked,
  });
  if (error) throw new Error(error.message);
  return asRuleRunsEnvelope(data);
}

export function useReplayMoneyCategoryRulePipelineForTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: replayMoneyCategoryRulePipelineForTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["money-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["money-transaction"] });
      queryClient.invalidateQueries({ queryKey: ["money-category-debug"] });
    },
  });
}

async function replayMoneyCategoryRulePipelineForDateRange({
  personId,
  from,
  to,
  forceOverwriteLocked = false,
}: {
  personId: string;
  from: string;
  to: string;
  forceOverwriteLocked?: boolean;
}): Promise<MoneyCategoryRuleRun[]> {
  if (await hasEnabledLlmRules(personId)) {
    const data = await callMoneyCategorizeAction<{ runs?: unknown[] }>({
      action: "replay_date_range",
      person_id: personId,
      from,
      to,
      force_overwrite_locked: forceOverwriteLocked,
    });
    return asRuleRunsEnvelope(data);
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("money_apply_category_rule_pipeline_for_date_range", {
    p_person_id: personId,
    p_from: from,
    p_to: to,
    p_force_overwrite_locked: forceOverwriteLocked,
  });
  if (error) throw new Error(error.message);
  return asRuleRunsEnvelope(data);
}

export function useReplayMoneyCategoryRulePipelineForDateRange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: replayMoneyCategoryRulePipelineForDateRange,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["money-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["money-transaction"] });
      queryClient.invalidateQueries({ queryKey: ["money-category-debug"] });
    },
  });
}
