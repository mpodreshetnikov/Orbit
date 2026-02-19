"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type {
  MoneyCard,
  CreateMoneyCardInput,
  UpdateMoneyCardInput,
} from "@/types";

async function fetchCardsByAccountId(accountId: string): Promise<MoneyCard[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_cards")
    .select("*")
    .eq("account_id", accountId)
    .order("last4", { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as MoneyCard[];
}

async function fetchCardsByAccountIds(accountIds: string[]): Promise<MoneyCard[]> {
  if (accountIds.length === 0) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_cards")
    .select("*")
    .in("account_id", accountIds)
    .order("account_id")
    .order("last4", { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as MoneyCard[];
}

export function useMoneyCardsByAccountId(accountId: string | null) {
  return useQuery({
    queryKey: ["money-cards", accountId],
    queryFn: () => fetchCardsByAccountId(accountId!),
    enabled: !!accountId,
  });
}

export function useMoneyCardsByAccountIds(accountIds: string[]) {
  const stableIds = accountIds.slice().sort();
  return useQuery({
    queryKey: ["money-cards-by-accounts", stableIds],
    queryFn: () => fetchCardsByAccountIds(stableIds),
    enabled: stableIds.length > 0,
  });
}

async function createMoneyCard(input: CreateMoneyCardInput): Promise<MoneyCard> {
  const supabase = createClient();
  const last4 = input.last4.replace(/\D/g, "").slice(-4);
  const payload = {
    account_id: input.account_id,
    last4: last4 || input.last4,
    card_label: input.card_label?.trim() || null,
  };
  const { data, error } = await supabase
    .from("money_cards")
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as MoneyCard;
}

export function useCreateMoneyCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMoneyCard,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["money-cards", data.account_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-cards-by-accounts"],
      });
    },
  });
}

async function updateMoneyCard({
  id,
  updates,
}: {
  id: string;
  accountId: string;
  updates: UpdateMoneyCardInput;
}): Promise<MoneyCard> {
  const supabase = createClient();
  const payload: Record<string, unknown> = { ...updates };
  if (updates.last4 !== undefined) {
    payload.last4 = updates.last4.replace(/\D/g, "").slice(-4) || updates.last4;
  }
  const { data, error } = await supabase
    .from("money_cards")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as MoneyCard;
}

export function useUpdateMoneyCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMoneyCard,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["money-cards", data.account_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-cards-by-accounts"],
      });
    },
  });
}

async function deleteMoneyCard({
  id,
}: {
  id: string;
  accountId: string;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("money_cards").delete().eq("id", id);

  if (error) throw new Error(error.message);
}

export function useDeleteMoneyCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMoneyCard,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["money-cards", variables.accountId],
      });
      queryClient.invalidateQueries({
        queryKey: ["money-cards-by-accounts"],
      });
    },
  });
}
