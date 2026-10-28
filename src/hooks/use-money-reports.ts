"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { Database } from "@/types/database";
import {
  normalizeBudgetReport,
  normalizeBudgetTarget,
  resolveMoneyFxSyncRange,
  toStringOrNull,
} from "@/types/money-reports";
import type { MoneyBudgetReport, MoneyBudgetTarget, MoneyTransferSelfAlias } from "@/types";
import {
  isoDay,
  normalizeSpendingReport,
  type SpendingPeriod,
  type SpendingReport,
} from "@/types/money-spending-report";

type SupabaseMoneyReportClient = ReturnType<typeof createClient> & {
  rpc: (
    fn: "money_get_budget_report" | "money_get_spending_report",
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  functions: {
    invoke: (
      fn: "money-fx-sync",
      options: { body: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

async function fetchMoneyBudgetReport(
  personId: string,
  monthStart: string,
  reportCurrency: string,
): Promise<MoneyBudgetReport> {
  const supabase = createClient() as SupabaseMoneyReportClient;
  const fxSyncRange = resolveMoneyFxSyncRange(monthStart);
  if (fxSyncRange) {
    const { error: syncError } = await supabase.functions.invoke("money-fx-sync", {
      body: {
        start_date: fxSyncRange.startDate,
        end_date: fxSyncRange.endDate,
        base_currency: "USD",
        quote_currencies: ["RUB"],
      },
    });
    if (syncError) throw new Error(syncError.message);
  }

  const { data, error } = await supabase.rpc("money_get_budget_report", {
    p_person_id: personId,
    p_month_start: monthStart,
    p_report_currency: reportCurrency,
  });

  if (error) throw new Error(error.message);

  const row = Array.isArray(data)
    ? ((data[0] as Record<string, unknown> | undefined) ?? null)
    : ((data as Record<string, unknown> | null) ?? null);

  return normalizeBudgetReport(row);
}

export function useMoneyBudgetReport(
  personId: string | null,
  monthStart: string,
  reportCurrency: string,
) {
  return useQuery({
    queryKey: ["money-budget-report", personId, monthStart, reportCurrency],
    queryFn: () => fetchMoneyBudgetReport(personId!, monthStart, reportCurrency),
    enabled: Boolean(personId),
  });
}

export interface SpendingReportRequest {
  personId: string;
  period: Pick<SpendingPeriod, "start" | "end">;
  currency: string;
  accountIds: string[];
  categoryId: string | null;
}

/**
 * The money report (T-261028-yhm). Rates are synced first from the start of last year, because the
 * report compares with last year's average and with twelve months of history, not only the period.
 */
async function fetchMoneySpendingReport(request: SpendingReportRequest): Promise<SpendingReport> {
  const supabase = createClient() as SupabaseMoneyReportClient;
  // The period's own rates, as the month report synced them: a period still ahead needs none, and
  // the comparisons use the rates already stored for those days.
  const today = isoDay(new Date());
  const syncEnd = request.period.end < today ? request.period.end : today;
  if (request.period.start <= syncEnd) {
    const { error: syncError } = await supabase.functions.invoke("money-fx-sync", {
      body: {
        start_date: request.period.start,
        end_date: syncEnd,
        base_currency: "USD",
        quote_currencies: ["RUB"],
      },
    });
    if (syncError) throw new Error(syncError.message);
  }

  const { data, error } = await supabase.rpc("money_get_spending_report", {
    p_person_id: request.personId,
    p_start: request.period.start,
    p_end: request.period.end,
    p_report_currency: request.currency,
    p_account_ids: request.accountIds.length > 0 ? request.accountIds : null,
    p_category_id: request.categoryId,
  });
  if (error) throw new Error(error.message);
  return normalizeSpendingReport(data);
}

export function useMoneySpendingReport(
  request: Omit<SpendingReportRequest, "personId"> & {
    personId: string | null;
  },
) {
  const { personId, period, currency, accountIds, categoryId } = request;
  return useQuery({
    queryKey: [
      "money-spending-report",
      personId,
      period.start,
      period.end,
      currency,
      [...accountIds].sort().join(","),
      categoryId,
    ],
    queryFn: () =>
      fetchMoneySpendingReport({ personId: personId!, period, currency, accountIds, categoryId }),
    enabled: Boolean(personId),
    placeholderData: (previous) => previous,
  });
}

type SelfAliasInsert = Database["public"]["Tables"]["money_transfer_self_aliases"]["Insert"];

type SupabaseMutationClient = ReturnType<typeof createClient> & {
  from: (relation: string) => {
    select: (columns?: string) => {
      single: () => Promise<{ data: unknown; error: { message: string } | null }>;
      order?: (
        column: string,
        options?: { ascending?: boolean },
      ) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
    insert: (values: Record<string, unknown>) => {
      select: (columns?: string) => {
        single: () => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
    upsert: (
      values: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      select: (columns?: string) => {
        single: () => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
    delete: () => {
      eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      match: (values: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
    eq: (
      column: string,
      value: string,
    ) => {
      order: (
        columnName: string,
        options?: { ascending?: boolean },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

export interface UpsertMoneyBudgetTargetInput {
  personId: string;
  categoryId: string;
  monthStart: string;
  targetAmount: number;
  currency: string;
}

async function upsertMoneyBudgetTarget(
  input: UpsertMoneyBudgetTargetInput,
): Promise<MoneyBudgetTarget> {
  const supabase = createClient() as SupabaseMutationClient;
  const { data, error } = await supabase
    .from("money_budget_targets")
    .upsert(
      {
        person_id: input.personId,
        category_id: input.categoryId,
        month_start: input.monthStart,
        target_amount: input.targetAmount,
        currency: input.currency,
      },
      {
        onConflict: "person_id,category_id,month_start",
      },
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const target = normalizeBudgetTarget(data);
  if (!target) {
    throw new Error("Budget target response is invalid");
  }

  return target;
}

export function useUpsertMoneyBudgetTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertMoneyBudgetTarget,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [
          "money-budget-report",
          variables.personId,
          variables.monthStart,
          variables.currency,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-budget-report", variables.personId, variables.monthStart],
      });
    },
  });
}

export interface DeleteMoneyBudgetTargetInput {
  personId: string;
  categoryId: string;
  monthStart: string;
}

async function deleteMoneyBudgetTarget(input: DeleteMoneyBudgetTargetInput): Promise<void> {
  const supabase = createClient() as SupabaseMutationClient;
  const { error } = await supabase.from("money_budget_targets").delete().match({
    person_id: input.personId,
    category_id: input.categoryId,
    month_start: input.monthStart,
  });

  if (error) throw new Error(error.message);
}

export function useDeleteMoneyBudgetTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMoneyBudgetTarget,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["money-budget-report", variables.personId, variables.monthStart],
      });
    },
  });
}

async function fetchMoneyTransferSelfAliases(personId: string): Promise<MoneyTransferSelfAlias[]> {
  // Against the real client, not the loose one: `from()` returns a builder with no `.eq` on it, so
  // the missing `.select()` here was a runtime TypeError that only the generated types could have
  // caught -- and they could not, because this table was missing from them (T-260829-el7).
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_transfer_self_aliases")
    .select("*")
    .eq("person_id", personId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const record = row as Record<string, unknown>;
      const id = toStringOrNull(record.id);
      const alias = toStringOrNull(record.alias);
      const normalizedAlias = toStringOrNull(record.normalized_alias);
      const person_id = toStringOrNull(record.person_id);
      if (!id || !alias || !normalizedAlias || !person_id) return null;
      return {
        id,
        alias,
        normalized_alias: normalizedAlias,
        person_id,
        created_at: toStringOrNull(record.created_at) ?? "",
        updated_at: toStringOrNull(record.updated_at) ?? "",
      } satisfies MoneyTransferSelfAlias;
    })
    .filter((entry): entry is MoneyTransferSelfAlias => entry !== null);
}

export function useMoneyTransferSelfAliases(personId: string | null) {
  return useQuery({
    queryKey: ["money-transfer-self-aliases", personId],
    queryFn: () => fetchMoneyTransferSelfAliases(personId!),
    enabled: Boolean(personId),
  });
}

export interface CreateMoneyTransferSelfAliasInput {
  personId: string;
  alias: string;
}

async function createMoneyTransferSelfAlias(
  input: CreateMoneyTransferSelfAliasInput,
): Promise<MoneyTransferSelfAlias> {
  const supabase = createClient();
  // `normalized_alias` is filled by the BEFORE INSERT trigger
  // `set_money_transfer_self_aliases_normalized_alias`, so the insert must not supply it. The
  // generated types cannot see triggers and mark the column required, which is what this cast
  // says -- and all it says.
  const payload: Omit<SelfAliasInsert, "normalized_alias"> = {
    person_id: input.personId,
    alias: input.alias,
  };
  const { data, error } = await supabase
    .from("money_transfer_self_aliases")
    .insert(payload as SelfAliasInsert)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const record = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : data;
  if (!record || typeof record !== "object") {
    throw new Error("Self-transfer alias response is invalid");
  }

  const aliasId = toStringOrNull((record as Record<string, unknown>).id);
  const aliasValue = toStringOrNull((record as Record<string, unknown>).alias);
  const normalizedAlias = toStringOrNull((record as Record<string, unknown>).normalized_alias);
  const personId = toStringOrNull((record as Record<string, unknown>).person_id);
  if (!aliasId || !aliasValue || !normalizedAlias || !personId) {
    throw new Error("Self-transfer alias response is invalid");
  }

  return {
    id: aliasId,
    alias: aliasValue,
    normalized_alias: normalizedAlias,
    person_id: personId,
    created_at: toStringOrNull((record as Record<string, unknown>).created_at) ?? "",
    updated_at: toStringOrNull((record as Record<string, unknown>).updated_at) ?? "",
  };
}

export function useCreateMoneyTransferSelfAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMoneyTransferSelfAlias,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["money-transfer-self-aliases", variables.personId],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-budget-report", variables.personId],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-spending-report", variables.personId],
      });
    },
  });
}

async function deleteMoneyTransferSelfAlias(id: string): Promise<void> {
  const supabase = createClient() as SupabaseMutationClient;
  const { error } = await supabase.from("money_transfer_self_aliases").delete().eq("id", id);

  if (error) throw new Error(error.message);
}

export function useDeleteMoneyTransferSelfAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMoneyTransferSelfAlias,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["money-transfer-self-aliases"] });
      queryClient.invalidateQueries({ queryKey: ["money-budget-report"] });
      queryClient.invalidateQueries({ queryKey: ["money-spending-report"] });
    },
  });
}
