"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  MoneyBudgetCategoryNode,
  MoneyBudgetFxStatus,
  MoneyBudgetReport,
  MoneyBudgetTarget,
  MoneyBudgetTrendPoint,
  MoneyTransferSelfAlias,
} from "@/types";

type RpcRow = Record<string, unknown>;
type RpcCategoryRow = Record<string, unknown>;

type SupabaseMoneyReportClient = ReturnType<typeof createClient> & {
  rpc: (
    fn: "money_get_budget_report",
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  functions: {
    invoke: (
      fn: "money-fx-sync",
      options: { body: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function lastDayOfMonth(value: string): string | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return formatIsoDate(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)));
}

function resolveMoneyFxSyncRange(
  monthStart: string,
  today: Date = new Date(),
): { startDate: string; endDate: string } | null {
  const monthStartDate = parseIsoDate(monthStart);
  const monthEnd = lastDayOfMonth(monthStart);
  if (!monthStartDate || !monthEnd) return null;

  const todayIso = formatIsoDate(today);
  const endDate = monthEnd < todayIso ? monthEnd : todayIso;
  if (endDate < monthStart) return null;

  return {
    startDate: monthStart,
    endDate,
  };
}

function normalizeBudgetTarget(value: unknown): MoneyBudgetTarget | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = toStringOrNull(row.id);
  const personId = toStringOrNull(row.person_id);
  const categoryId = toStringOrNull(row.category_id);
  const monthStart = toStringOrNull(row.month_start);
  if (!id || !personId || !categoryId || !monthStart) return null;
  return {
    id,
    person_id: personId,
    category_id: categoryId,
    month_start: monthStart,
    target_amount: toNumber(row.target_amount),
    currency: toStringOrNull(row.currency) ?? "RUB",
    created_at: toStringOrNull(row.created_at) ?? "",
    updated_at: toStringOrNull(row.updated_at) ?? "",
  };
}

function normalizeBudgetCategoryNode(value: unknown): MoneyBudgetCategoryNode {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    id: toStringOrNull(row.id) ?? "",
    parent_id: toStringOrNull(row.parent_id),
    canonical_category_id: toStringOrNull(row.canonical_category_id),
    depth: toNumber(row.depth),
    name_en: toStringOrNull(row.name_en) ?? "",
    name_ru: toStringOrNull(row.name_ru) ?? "",
    slug: toStringOrNull(row.slug),
    archived_at: toStringOrNull(row.archived_at),
    is_uncategorized: Boolean(row.is_uncategorized),
    actual_income: toNumber(row.actual_income),
    actual_expenses: toNumber(row.actual_expenses),
    actual_net: toNumber(row.actual_net),
    target_amount: toNumber(row.target_amount),
    variance_amount: toNumber(row.variance_amount),
    target: normalizeBudgetTarget(row.target),
    children: Array.isArray(row.children)
      ? row.children.map((child) => normalizeBudgetCategoryNode(child))
      : [],
  };
}

function buildBudgetCategoryTree(
  values: unknown,
  monthStart: string,
  reportCurrency: string,
): MoneyBudgetCategoryNode[] {
  if (!Array.isArray(values)) return [];

  const index = new Map<
    string,
    {
      node: MoneyBudgetCategoryNode;
      parentId: string | null;
      order: number;
    }
  >();

  values.forEach((value, order) => {
    if (!value || typeof value !== "object") return;
    const row = value as RpcCategoryRow;
    const id = toStringOrNull(row.id);
    if (!id) return;

    const directTargetAmount = toNumber(row.direct_target_amount);
    index.set(id, {
      parentId: toStringOrNull(row.parent_id),
      order,
      node: {
        id,
        parent_id: toStringOrNull(row.parent_id),
        canonical_category_id: toStringOrNull(row.canonical_category_id),
        depth: toNumber(row.depth),
        name_en: toStringOrNull(row.name_en) ?? "",
        name_ru: toStringOrNull(row.name_ru) ?? "",
        slug: toStringOrNull(row.slug),
        archived_at: toStringOrNull(row.archived_at),
        is_uncategorized: toStringOrNull(row.system_key) === "uncategorized",
        actual_income: toNumber(row.actual_income),
        actual_expenses: toNumber(row.actual_expense ?? row.actual_expenses),
        actual_net: toNumber(row.actual_net),
        target_amount: toNumber(row.target_amount),
        variance_amount: toNumber(row.variance_amount),
        target:
          directTargetAmount !== 0
            ? {
                id: `money-budget-target:${id}:${monthStart}`,
                person_id: "",
                category_id: id,
                month_start: monthStart,
                target_amount: directTargetAmount,
                currency: reportCurrency,
                created_at: "",
                updated_at: "",
              }
            : null,
        children: [],
      },
    });
  });

  const roots: Array<{ node: MoneyBudgetCategoryNode; order: number }> = [];
  const sortedEntries = Array.from(index.values()).sort((left, right) => left.order - right.order);

  sortedEntries.forEach((entry) => {
    if (!entry.parentId || !index.has(entry.parentId)) {
      roots.push({ node: entry.node, order: entry.order });
      return;
    }
    index.get(entry.parentId)!.node.children.push(entry.node);
  });

  return roots.sort((left, right) => left.order - right.order).map((entry) => entry.node);
}

function normalizeBudgetTrendPoint(value: unknown): MoneyBudgetTrendPoint {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    date: toStringOrNull(row.date) ?? "",
    income: toNumber(row.income ?? row.actual_income),
    expenses: toNumber(row.expenses ?? row.actual_expense),
    net: toNumber(row.net ?? row.actual_net),
  };
}

function normalizeBudgetFxStatus(value: unknown): MoneyBudgetFxStatus {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawStatus = toStringOrNull(row.status ?? row.mode) ?? "ok";
  const missingConversions = Array.isArray(row.missing_conversions)
    ? row.missing_conversions
    : Array.isArray(row.missing_pairs)
      ? row.missing_pairs
      : [];
  const approximatedConversions = Array.isArray(row.approximated_conversions)
    ? row.approximated_conversions
    : Array.isArray(row.approximated_dates)
      ? row.approximated_dates
      : [];

  return {
    mode:
      rawStatus === "approximated"
        ? "approximate"
        : rawStatus === "error"
          ? "missing"
          : rawStatus === "missing"
            ? "missing"
            : rawStatus === "approximate"
              ? "approximate"
              : "ok",
    approximated_dates: approximatedConversions
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return null;
        return toStringOrNull((entry as Record<string, unknown>).conversion_date);
      })
      .filter((entry): entry is string => Boolean(entry)),
    missing_pairs: missingConversions
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const sourceCurrency = toStringOrNull(record.source_currency);
        const conversionDate = toStringOrNull(record.conversion_date);
        return sourceCurrency && conversionDate
          ? `${sourceCurrency}:${conversionDate}`
          : sourceCurrency;
      })
      .filter((entry): entry is string => Boolean(entry)),
    message: toStringOrNull(row.message),
    is_blocking: rawStatus === "error" || rawStatus === "missing" || Boolean(row.is_blocking),
  };
}

function normalizeBudgetReport(row: RpcRow | null | undefined): MoneyBudgetReport {
  const safeRow = row ?? {};
  const monthStart = toStringOrNull(safeRow.month_start ?? safeRow.report_month_start) ?? "";
  const currency = toStringOrNull(safeRow.report_currency ?? safeRow.currency) ?? "RUB";
  const categories = Array.isArray(safeRow.categories)
    ? safeRow.categories.map((node) => normalizeBudgetCategoryNode(node))
    : buildBudgetCategoryTree(safeRow.category_rows, monthStart, currency);

  return {
    month_start: monthStart,
    currency,
    summary: {
      actual_income: toNumber(safeRow.actual_income),
      actual_expenses: toNumber(safeRow.actual_expense ?? safeRow.actual_expenses),
      actual_net: toNumber(safeRow.actual_net),
      target_income: toNumber(safeRow.target_income),
      target_expenses: toNumber(safeRow.target_expense ?? safeRow.target_expenses),
      target_net: toNumber(safeRow.target_net),
      variance_net: toNumber(safeRow.net_variance ?? safeRow.variance_net),
    },
    categories,
    trend: Array.isArray(safeRow.trend)
      ? safeRow.trend.map((point) => normalizeBudgetTrendPoint(point))
      : Array.isArray(safeRow.trend_points)
        ? safeRow.trend_points.map((point) => normalizeBudgetTrendPoint(point))
        : [],
    fx_status: normalizeBudgetFxStatus(safeRow.fx_status),
  };
}

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
  const supabase = createClient() as SupabaseMutationClient;
  const relation = supabase.from("money_transfer_self_aliases").eq("person_id", personId);
  const { data, error } = await relation.order("created_at", { ascending: false });

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
  const supabase = createClient() as SupabaseMutationClient;
  const { data, error } = await supabase
    .from("money_transfer_self_aliases")
    .insert({
      person_id: input.personId,
      alias: input.alias,
    })
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
    },
  });
}
