"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import { REQUEST_TIMEOUT_MS, timeoutSignal } from "@/lib/request-timeout";
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
  MoneyTransactionFeedPage,
  MoneyTransactionFeedSummary,
  UpdateMoneyTransactionInput,
} from "@/types";
import type { Database } from "@/types/database";
import {
  feedSummaryOf,
  MONEY_FEED_PAGE_SIZE,
  moneyFeedArgs,
  normalizeFeedItem,
} from "@/types/money-feed";
import {
  lineItemChanges,
  lineItemRow,
  lineItemsOrWhole,
  transactionInsertRow,
} from "@/types/money-transaction-form";

type MoneyTransactionInsert = Database["public"]["Tables"]["money_transactions"]["Insert"];
type MoneyLineItemInsert = Database["public"]["Tables"]["money_line_items"]["Insert"];
type MoneyLineItemUpdate = Database["public"]["Tables"]["money_line_items"]["Update"];

/**
 * One retry, not react-query's three: each attempt has the request budget, and three retries
 * would keep the skeleton up for a minute and a half before the page could say nothing is coming.
 */
const FEED_RETRIES = 1;

export interface MoneyTransactionsFilters {
  accountId?: string | null;
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
  signal,
}: {
  payerPersonId: string;
  filters: MoneyTransactionFeedFilters;
  pageParam: number;
  signal?: AbortSignal;
}): Promise<MoneyTransactionFeedPage> {
  const supabase = createClient() as ReturnType<typeof createClient> & {
    rpc: (
      fn: "money_list_transactions_feed",
      args: Record<string, unknown>,
    ) => {
      abortSignal: (
        signal: AbortSignal,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
  const { data, error } = await supabase
    .rpc("money_list_transactions_feed", {
      ...moneyFeedArgs(payerPersonId, filters),
      p_offset: pageParam,
      p_limit: MONEY_FEED_PAGE_SIZE,
    })
    .abortSignal(timeoutSignal(REQUEST_TIMEOUT_MS, signal));

  if (error) throw new Error(error.message);

  const items = Array.isArray(data)
    ? data.map((item: unknown) => normalizeFeedItem(item as Record<string, unknown>))
    : [];

  return {
    items,
    nextOffset: items.length === MONEY_FEED_PAGE_SIZE ? pageParam + items.length : null,
  };
}

async function fetchMoneyTransactionFeedSummary(
  payerPersonId: string,
  filters: MoneyTransactionFeedFilters,
  signal?: AbortSignal,
): Promise<MoneyTransactionFeedSummary> {
  const supabase = createClient() as ReturnType<typeof createClient> & {
    rpc: (
      fn: "money_transaction_feed_summary",
      args: Record<string, unknown>,
    ) => {
      abortSignal: (
        signal: AbortSignal,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
  const { data, error } = await supabase
    .rpc("money_transaction_feed_summary", moneyFeedArgs(payerPersonId, filters))
    .abortSignal(timeoutSignal(REQUEST_TIMEOUT_MS, signal));

  if (error) throw new Error(error.message);

  return feedSummaryOf(data);
}

export function useInfiniteMoneyTransactionFeed(
  payerPersonId: string | null,
  filters: MoneyTransactionFeedFilters = {},
) {
  return useInfiniteQuery({
    queryKey: ["money-transaction-feed", payerPersonId, filters],
    queryFn: ({ pageParam, signal }) =>
      fetchMoneyTransactionFeedPage({
        payerPersonId: payerPersonId!,
        filters,
        pageParam,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!payerPersonId,
    retry: FEED_RETRIES,
  });
}

export function useMoneyTransactionFeedSummary(
  payerPersonId: string | null,
  filters: MoneyTransactionFeedFilters = {},
) {
  return useQuery({
    queryKey: ["money-transaction-feed-summary", payerPersonId, filters],
    queryFn: ({ signal }) => fetchMoneyTransactionFeedSummary(payerPersonId!, filters, signal),
    enabled: !!payerPersonId,
    retry: FEED_RETRIES,
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

async function createMoneyTransactionWithLines({
  transaction,
  lineItems,
}: {
  transaction: CreateMoneyTransactionInput;
  lineItems: CreateMoneyLineItemInput[];
}): Promise<MoneyTransactionDetail> {
  const supabase = createClient();
  const txPayload = transactionInsertRow(transaction) as MoneyTransactionInsert;

  const { data: tx, error } = await supabase
    .from("money_transactions")
    .insert(txPayload)
    .select()
    .single();

  if (error) throw new Error(error.message);

  const items = lineItemsOrWhole(lineItems, transaction.merchant_name, transaction.amount).map(
    (item) => lineItemRow(item, tx.id) as MoneyLineItemInsert,
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

  const items = lineItemsOrWhole(lineItems, updates.merchant_name, updates.amount ?? 0);
  const { data: currentLineRows, error: currentLineError } = await supabase
    .from("money_line_items")
    .select("id")
    .eq("transaction_id", id);

  if (currentLineError) throw new Error(currentLineError.message);

  const {
    removed: removedLineIds,
    changed,
    added: newItems,
  } = lineItemChanges(
    (currentLineRows ?? []).map((row) => row.id),
    items,
  );

  if (removedLineIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("money_line_items")
      .delete()
      .in("id", removedLineIds);

    if (deleteError) throw new Error(deleteError.message);
  }

  const updatedLineMap = new Map<string, MoneyLineItem>();

  for (const item of changed) {
    const { data: updatedLine, error: updateLineError } = await supabase
      .from("money_line_items")
      .update(lineItemRow(item, id) as MoneyLineItemUpdate)
      .eq("id", item.id!)
      .select()
      .single();

    if (updateLineError) throw new Error(updateLineError.message);
    updatedLineMap.set(item.id!, updatedLine as MoneyLineItem);
  }

  let insertedLines: MoneyLineItem[] = [];
  if (newItems.length > 0) {
    const { data: insertedLineRows, error: lineError } = await supabase
      .from("money_line_items")
      .insert(newItems.map((item) => lineItemRow(item, id) as MoneyLineItemInsert))
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
