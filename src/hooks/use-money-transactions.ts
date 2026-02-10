"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  MoneyTransaction,
  MoneyTransactionDetail,
  MoneyLineItem,
  CreateMoneyTransactionInput,
  UpdateMoneyTransactionInput,
  CreateMoneyLineItemInput,
} from "@/types";

export interface MoneyTransactionsFilters {
  accountId?: string | null;
}

function mapDetailRow(row: Record<string, unknown>): MoneyTransactionDetail {
  const lineItemsRaw = (row.money_line_items as MoneyLineItem[] | null) ?? [];
  const { money_line_items: _ignore, ...tx } = row as Record<string, unknown>;
  return {
    ...(tx as MoneyTransaction),
    line_items: lineItemsRaw,
  };
}

async function fetchMoneyTransactions(
  payerPersonId: string,
  filters: MoneyTransactionsFilters = {}
): Promise<MoneyTransaction[]> {
  const supabase = createClient();
  let query = supabase
    .from("money_transactions")
    .select("*")
    .eq("payer_person_id", payerPersonId)
    .order("posted_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.accountId) {
    query = query.eq("account_id", filters.accountId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as MoneyTransaction[];
}

export function useMoneyTransactions(
  payerPersonId: string | null,
  filters: MoneyTransactionsFilters = {}
) {
  return useQuery({
    queryKey: ["money-transactions", payerPersonId, filters],
    queryFn: () => fetchMoneyTransactions(payerPersonId!, filters),
    enabled: !!payerPersonId,
  });
}

async function fetchMoneyTransactionDetail(
  id: string
): Promise<MoneyTransactionDetail | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_transactions")
    .select("*, money_line_items(*)")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }

  return data ? mapDetailRow(data as Record<string, unknown>) : null;
}

export function useMoneyTransaction(id: string | null) {
  return useQuery({
    queryKey: ["money-transaction", id],
    queryFn: () => fetchMoneyTransactionDetail(id!),
    enabled: !!id,
  });
}

function ensureLineItems(
  lineItems: CreateMoneyLineItemInput[],
  fallback: CreateMoneyLineItemInput
): CreateMoneyLineItemInput[] {
  if (!lineItems || lineItems.length === 0) {
    return [fallback];
  }
  return lineItems;
}

async function createMoneyTransactionWithLines({
  transaction,
  lineItems,
}: {
  transaction: CreateMoneyTransactionInput;
  lineItems: CreateMoneyLineItemInput[];
}): Promise<MoneyTransactionDetail> {
  const supabase = createClient();

  const { data: tx, error } = await supabase
    .from("money_transactions")
    .insert({
      payer_person_id: transaction.payer_person_id,
      account_id: transaction.account_id,
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
      is_transfer: transaction.is_transfer ?? false,
      transfer_group_id: transaction.transfer_group_id ?? null,
      raw_payload: transaction.raw_payload ?? null,
      dedupe_hash: transaction.dedupe_hash ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  const fallbackItem: CreateMoneyLineItemInput = {
    title: transaction.merchant_name?.trim() || "Manual item",
    amount: transaction.amount,
    line_status: "final",
    assignment_method: "manual",
  };

  const items = ensureLineItems(lineItems, fallbackItem).map((item) => ({
    transaction_id: tx.id,
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
    raw_payload: item.raw_payload ?? null,
  }));

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

  const items = ensureLineItems(lineItems, fallbackItem).map((item) => ({
    transaction_id: id,
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
    raw_payload: item.raw_payload ?? null,
  }));

  const { error: deleteError } = await supabase
    .from("money_line_items")
    .delete()
    .eq("transaction_id", id);

  if (deleteError) throw new Error(deleteError.message);

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

export function useUpdateMoneyTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMoneyTransactionWithLines,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["money-transaction", data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-transactions", data.payer_person_id],
      });
    },
  });
}

async function deleteMoneyTransaction({
  id,
  payerPersonId,
}: {
  id: string;
  payerPersonId: string;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("money_transactions")
    .delete()
    .eq("id", id);

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
    },
  });
}
