"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  CreateMoneyLineItemInput,
  CreateMoneyTransactionInput,
  MoneyLineItem,
  MoneyTransaction,
  MoneyTransactionBrand,
  MoneyTransactionCard,
  MoneyTransactionDetail,
  MoneyTransactionEditAudit,
  MoneyTransactionFeedFilters,
  MoneyTransactionFeedItem,
  MoneyTransactionFeedPage,
  MoneyTransactionFeedSummary,
  UpdateMoneyTransactionInput,
} from "@/types";
import type { Database, Json } from "@/types/database";

type MoneyTransactionInsert = Database["public"]["Tables"]["money_transactions"]["Insert"];
type MoneyLineItemInsert = Database["public"]["Tables"]["money_line_items"]["Insert"];
type MoneyLineItemUpdate = Database["public"]["Tables"]["money_line_items"]["Update"];

const MONEY_TRANSACTION_FEED_PAGE_SIZE = 50;

export interface MoneyTransactionsFilters {
  accountId?: string | null;
}

function toJsonOrNull(value: Record<string, unknown> | null | undefined): Json | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value as unknown as Json;
}

function mapDetailRow(row: Record<string, unknown>): MoneyTransactionDetail {
  const lineItemsRaw = (row.money_line_items as MoneyLineItem[] | null) ?? [];
  const tx = { ...(row as Record<string, unknown>) };
  delete tx.money_line_items;
  return {
    ...(tx as unknown as MoneyTransaction),
    line_items: lineItemsRaw,
  };
}

function normalizeFeedItem(item: Record<string, unknown>): MoneyTransactionFeedItem {
  const rawLineItems = Array.isArray(item.line_items)
    ? (item.line_items as Array<Record<string, unknown>>)
    : [];
  const lineItemTitles = Array.isArray(item.line_item_titles)
    ? (item.line_item_titles as string[])
    : rawLineItems
        .map((lineItem) => (typeof lineItem.title === "string" ? lineItem.title : null))
        .filter((title): title is string => Boolean(title));
  const moneyCards =
    item.money_cards !== undefined
      ? ((item.money_cards as MoneyTransactionCard | null) ?? null)
      : item.card_last4 || item.card_label || item.card_id
        ? {
            id: String(item.card_id ?? ""),
            last4: typeof item.card_last4 === "string" ? item.card_last4 : "",
            card_label: typeof item.card_label === "string" ? item.card_label : null,
          }
        : undefined;

  return {
    ...(item as unknown as MoneyTransactionFeedItem),
    ...(moneyCards !== undefined ? { money_cards: moneyCards } : {}),
    line_item_titles: lineItemTitles,
    category_ids: Array.isArray(item.category_ids) ? (item.category_ids as string[]) : [],
  };
}

export type MoneyTransactionWithCard = MoneyTransaction & {
  money_cards: MoneyTransactionCard | null;
  money_transaction_brands: MoneyTransactionBrand | null;
};

async function fetchMoneyTransactions(
  payerPersonId: string,
  filters: MoneyTransactionsFilters = {},
): Promise<MoneyTransactionWithCard[]> {
  const supabase = createClient();
  let query = supabase
    .from("money_transactions")
    .select("*, money_cards(id, last4, card_label), money_transaction_brands(*)")
    .eq("payer_person_id", payerPersonId)
    .order("posted_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.accountId) {
    query = query.eq("account_id", filters.accountId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as MoneyTransactionWithCard[];
}

export function useMoneyTransactions(
  payerPersonId: string | null,
  filters: MoneyTransactionsFilters = {},
) {
  return useQuery({
    queryKey: ["money-transactions", payerPersonId, filters],
    queryFn: () => fetchMoneyTransactions(payerPersonId!, filters),
    enabled: !!payerPersonId,
  });
}

async function fetchMoneyTransactionDetail(id: string): Promise<
  | (MoneyTransactionDetail & {
      money_cards: MoneyTransactionCard | null;
      money_transaction_brands: MoneyTransactionBrand | null;
    })
  | null
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_transactions")
    .select(
      "*, money_cards(id, last4, card_label), money_transaction_brands(*), money_line_items(*)",
    )
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }

  return data
    ? (mapDetailRow(data as Record<string, unknown>) as MoneyTransactionDetail & {
        money_cards: MoneyTransactionCard | null;
        money_transaction_brands: MoneyTransactionBrand | null;
      })
    : null;
}

export function useMoneyTransaction(id: string | null) {
  return useQuery({
    queryKey: ["money-transaction", id],
    queryFn: () => fetchMoneyTransactionDetail(id!),
    enabled: !!id,
  });
}

async function fetchMoneyTransactionFeedPage({
  payerPersonId,
  filters,
  pageParam,
}: {
  payerPersonId: string;
  filters: MoneyTransactionFeedFilters;
  pageParam: number;
}): Promise<MoneyTransactionFeedPage> {
  const supabase = createClient() as ReturnType<typeof createClient> & {
    rpc: (
      fn: "money_list_transactions_feed",
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await supabase.rpc("money_list_transactions_feed", {
    p_payer_person_id: payerPersonId,
    p_search: filters.query?.trim() || null,
    p_account_ids: filters.accountIds?.length ? filters.accountIds : null,
    p_transaction_types: filters.transactionTypes?.length ? filters.transactionTypes : null,
    p_statuses: filters.statuses?.length ? filters.statuses : null,
    p_category_ids: filters.categoryIds?.length ? filters.categoryIds : null,
    p_transfer_filter: filters.transferFilter ?? "all",
    p_amount_sign: filters.amountSign ?? "all",
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_offset: pageParam,
    p_limit: MONEY_TRANSACTION_FEED_PAGE_SIZE,
  });

  if (error) throw new Error(error.message);

  const items = Array.isArray(data)
    ? data.map((item: unknown) => normalizeFeedItem(item as Record<string, unknown>))
    : [];

  return {
    items,
    nextOffset: items.length === MONEY_TRANSACTION_FEED_PAGE_SIZE ? pageParam + items.length : null,
  };
}

async function fetchMoneyTransactionFeedSummary(
  payerPersonId: string,
  filters: MoneyTransactionFeedFilters,
): Promise<MoneyTransactionFeedSummary> {
  const supabase = createClient() as ReturnType<typeof createClient> & {
    rpc: (
      fn: "money_transaction_feed_summary",
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await supabase.rpc("money_transaction_feed_summary", {
    p_payer_person_id: payerPersonId,
    p_search: filters.query?.trim() || null,
    p_account_ids: filters.accountIds?.length ? filters.accountIds : null,
    p_transaction_types: filters.transactionTypes?.length ? filters.transactionTypes : null,
    p_statuses: filters.statuses?.length ? filters.statuses : null,
    p_category_ids: filters.categoryIds?.length ? filters.categoryIds : null,
    p_transfer_filter: filters.transferFilter ?? "all",
    p_amount_sign: filters.amountSign ?? "all",
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
  });

  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;

  return {
    totalCount: Number(row?.total_count ?? 0),
    totalPositiveAmount: Number(row?.total_positive_amount ?? 0),
    totalNegativeAmount: Number(row?.total_negative_amount ?? 0),
  };
}

export function useInfiniteMoneyTransactionFeed(
  payerPersonId: string | null,
  filters: MoneyTransactionFeedFilters = {},
) {
  return useInfiniteQuery({
    queryKey: ["money-transaction-feed", payerPersonId, filters],
    queryFn: ({ pageParam }) =>
      fetchMoneyTransactionFeedPage({
        payerPersonId: payerPersonId!,
        filters,
        pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!payerPersonId,
  });
}

export function useMoneyTransactionFeedSummary(
  payerPersonId: string | null,
  filters: MoneyTransactionFeedFilters = {},
) {
  return useQuery({
    queryKey: ["money-transaction-feed-summary", payerPersonId, filters],
    queryFn: () => fetchMoneyTransactionFeedSummary(payerPersonId!, filters),
    enabled: !!payerPersonId,
  });
}

async function fetchMoneyTransactionEditAudits(
  transactionId: string,
): Promise<MoneyTransactionEditAudit[]> {
  const supabase = createClient() as ReturnType<typeof createClient> & {
    from: (relation: "money_transaction_edit_audits") => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          order: (
            column: string,
            options: { ascending: boolean },
          ) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
  const { data, error } = await supabase
    .from("money_transaction_edit_audits")
    .select("*")
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MoneyTransactionEditAudit[];
}

export function useMoneyTransactionEditAudits(transactionId: string | null) {
  return useQuery({
    queryKey: ["money-transaction-edit-audits", transactionId],
    queryFn: () => fetchMoneyTransactionEditAudits(transactionId!),
    enabled: !!transactionId,
  });
}

function ensureLineItems(
  lineItems: CreateMoneyLineItemInput[],
  fallback: CreateMoneyLineItemInput,
): CreateMoneyLineItemInput[] {
  if (!lineItems || lineItems.length === 0) {
    return [fallback];
  }
  return lineItems;
}

function toLineItemMutationPayload(
  item: CreateMoneyLineItemInput,
  transactionId: string,
): MoneyLineItemInsert & MoneyLineItemUpdate {
  return {
    transaction_id: transactionId,
    title: item.title,
    amount: item.amount,
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    line_status: item.line_status ?? "final",
    related_line_item_id: item.related_line_item_id ?? null,
    category_id: item.category_id ?? null,
    beneficiary_person_id: item.beneficiary_person_id ?? null,
    assignment_method: item.assignment_method ?? "manual",
    assignment_rule_id: item.assignment_rule_id ?? null,
    assignment_confidence: item.assignment_confidence ?? null,
    category_locked_by_user: item.category_locked_by_user ?? false,
    raw_payload: toJsonOrNull(item.raw_payload) ?? null,
    last_category_rule_id: item.last_category_rule_id ?? null,
    last_category_rule_run_id: item.last_category_rule_run_id ?? null,
    category_assigned_at: item.category_assigned_at ?? null,
  };
}

async function createMoneyTransactionWithLines({
  transaction,
  lineItems,
}: {
  transaction: CreateMoneyTransactionInput;
  lineItems: CreateMoneyLineItemInput[];
}): Promise<MoneyTransactionDetail> {
  const supabase = createClient();
  const txPayload: MoneyTransactionInsert = {
    payer_person_id: transaction.payer_person_id,
    account_id: transaction.account_id,
    brand_id: transaction.brand_id ?? null,
    source: transaction.source ?? "manual",
    external_id: transaction.external_id ?? null,
    posted_at: transaction.posted_at,
    amount: transaction.amount,
    currency: transaction.currency,
    transaction_type: transaction.transaction_type,
    status: transaction.status ?? "posted",
    merchant_name: transaction.merchant_name ?? null,
    mcc: transaction.mcc ?? null,
    comment: transaction.comment ?? null,
    source_comment: transaction.source_comment ?? null,
    cashback_amount: transaction.cashback_amount ?? null,
    cashback_currency: transaction.cashback_currency ?? null,
    operation_icon_url: transaction.operation_icon_url ?? null,
    source_category_id: transaction.source_category_id ?? null,
    source_category_name: transaction.source_category_name ?? null,
    is_transfer: transaction.is_transfer ?? false,
    transfer_group_id: transaction.transfer_group_id ?? null,
    raw_payload: toJsonOrNull(transaction.raw_payload) ?? null,
    dedupe_hash: transaction.dedupe_hash ?? null,
  } as MoneyTransactionInsert;

  const { data: tx, error } = await supabase
    .from("money_transactions")
    .insert(txPayload)
    .select()
    .single();

  if (error) throw new Error(error.message);

  const fallbackItem: CreateMoneyLineItemInput = {
    title: transaction.merchant_name?.trim() || "Manual item",
    amount: transaction.amount,
    line_status: "final",
    assignment_method: "manual",
  };

  const items: MoneyLineItemInsert[] = ensureLineItems(lineItems, fallbackItem).map((item) =>
    toLineItemMutationPayload(item, tx.id),
  );

  const { data: lines, error: lineError } = await supabase
    .from("money_line_items")
    .insert(items)
    .select();

  if (lineError) throw new Error(lineError.message);

  return {
    ...(tx as MoneyTransaction),
    line_items: (lines || []) as MoneyLineItem[],
  };
}

export function useCreateMoneyTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMoneyTransactionWithLines,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["money-transactions", data.payer_person_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-transaction-feed", data.payer_person_id],
      });
    },
  });
}

async function updateMoneyTransactionWithLines({
  id,
  updates,
  lineItems,
}: {
  id: string;
  updates: UpdateMoneyTransactionInput;
  lineItems: CreateMoneyLineItemInput[];
}): Promise<MoneyTransactionDetail> {
  const supabase = createClient();

  const { data: tx, error } = await supabase
    .from("money_transactions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  const fallbackItem: CreateMoneyLineItemInput = {
    title: updates.merchant_name?.trim() || "Manual item",
    amount: updates.amount ?? 0,
    line_status: "final",
    assignment_method: "manual",
  };

  const items = ensureLineItems(lineItems, fallbackItem);
  const { data: currentLineRows, error: currentLineError } = await supabase
    .from("money_line_items")
    .select("id")
    .eq("transaction_id", id);

  if (currentLineError) throw new Error(currentLineError.message);

  const currentLineIds = new Set((currentLineRows ?? []).map((row) => row.id));
  const submittedExistingIds = new Set(
    items.map((item) => item.id).filter((value): value is string => Boolean(value)),
  );
  const removedLineIds = [...currentLineIds].filter((lineId) => !submittedExistingIds.has(lineId));

  if (removedLineIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("money_line_items")
      .delete()
      .in("id", removedLineIds);

    if (deleteError) throw new Error(deleteError.message);
  }

  const updatedLineMap = new Map<string, MoneyLineItem>();
  const newItems = items.filter((item) => !item.id || !currentLineIds.has(item.id));

  for (const item of items) {
    if (!item.id || !currentLineIds.has(item.id)) {
      continue;
    }

    const { data: updatedLine, error: updateLineError } = await supabase
      .from("money_line_items")
      .update(toLineItemMutationPayload(item, id))
      .eq("id", item.id)
      .select()
      .single();

    if (updateLineError) throw new Error(updateLineError.message);
    updatedLineMap.set(item.id, updatedLine as MoneyLineItem);
  }

  let insertedLines: MoneyLineItem[] = [];
  if (newItems.length > 0) {
    const { data: insertedLineRows, error: lineError } = await supabase
      .from("money_line_items")
      .insert(newItems.map((item) => toLineItemMutationPayload(item, id)))
      .select();

    if (lineError) throw new Error(lineError.message);
    insertedLines = (insertedLineRows ?? []) as MoneyLineItem[];
  }

  const insertedLineQueue = [...insertedLines];
  const lines = items.map((item) => {
    if (item.id && updatedLineMap.has(item.id)) {
      return updatedLineMap.get(item.id)!;
    }
    return insertedLineQueue.shift() as MoneyLineItem;
  });

  return {
    ...(tx as MoneyTransaction),
    line_items: lines,
  };
}

export function useUpdateMoneyTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMoneyTransactionWithLines,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["money-transaction", data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-transaction-edit-audits", data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-transactions", data.payer_person_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-transaction-feed", data.payer_person_id],
      });
    },
  });
}

async function deleteMoneyTransaction({
  id,
}: {
  id: string;
  payerPersonId: string;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("money_transactions").delete().eq("id", id);

  if (error) throw new Error(error.message);
}

export function useDeleteMoneyTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMoneyTransaction,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["money-transactions", variables.payerPersonId],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-transaction-feed", variables.payerPersonId],
      });
    },
  });
}
