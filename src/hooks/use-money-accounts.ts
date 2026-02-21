"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";
import type { MoneyAccount, CreateMoneyAccountInput, UpdateMoneyAccountInput } from "@/types";

async function fetchMoneyAccounts(ownerPersonId: string): Promise<MoneyAccount[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_accounts")
    .select("*")
    .eq("owner_person_id", ownerPersonId)
    .order("is_active", { ascending: false })
    .order("account_label", { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as MoneyAccount[];
}

export function useMoneyAccounts(ownerPersonId: string | null) {
  return useQuery({
    queryKey: ["money-accounts", ownerPersonId],
    queryFn: () => fetchMoneyAccounts(ownerPersonId!),
    enabled: !!ownerPersonId,
  });
}

async function createMoneyAccount(input: CreateMoneyAccountInput): Promise<MoneyAccount> {
  const supabase = createClient();
  const payload = {
    owner_person_id: input.owner_person_id,
    source: input.source ?? "manual",
    account_kind: input.account_kind,
    account_label: input.account_label,
    currency: input.currency,
    external_account_id: input.external_account_id ?? null,
    is_active: input.is_active ?? true,
  };
  const { data, error } = await supabase.from("money_accounts").insert(payload).select().single();

  if (error) throw new Error(error.message);
  return data as MoneyAccount;
}

export function useCreateMoneyAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMoneyAccount,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["money-accounts", data.owner_person_id],
      });
    },
  });
}

async function updateMoneyAccount({
  id,
  updates,
}: {
  id: string;
  updates: UpdateMoneyAccountInput;
}): Promise<MoneyAccount> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("money_accounts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as MoneyAccount;
}

export function useUpdateMoneyAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMoneyAccount,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["money-accounts", data.owner_person_id],
      });
    },
  });
}

async function deleteMoneyAccount({ id }: { id: string; ownerPersonId: string }): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("money_accounts").delete().eq("id", id);

  if (error) throw new Error(error.message);
}

export function useDeleteMoneyAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMoneyAccount,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["money-accounts", variables.ownerPersonId],
      });
    },
  });
}
