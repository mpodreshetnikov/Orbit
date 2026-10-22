import type { MoneyCard } from "@orbit-types/money";
import type { accountColumns } from "@orbit-types/money-accounts";
import { supabase } from "@/lib/supabase";

export type AccountColumns = NonNullable<ReturnType<typeof accountColumns>>;

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** The accounts' cards, by account and last digits. */
export async function fetchCards(accountIds: string[]): Promise<MoneyCard[]> {
  if (accountIds.length === 0) return [];
  const rows = check(
    await supabase
      .from("money_cards")
      .select("*")
      .in("account_id", accountIds)
      .order("account_id")
      .order("last4", { ascending: true }),
  );
  return (rows ?? []) as MoneyCard[];
}

/** Add an account for the person, change one by `id`, or delete it when `columns` is null. */
export async function saveAccount(
  personId: string,
  id: string | undefined,
  columns: AccountColumns | null,
): Promise<void> {
  const table = supabase.from("money_accounts");
  if (!columns) check(await table.delete().eq("id", id!));
  else if (id) check(await table.update(columns).eq("id", id));
  else check(await table.insert({ owner_person_id: personId, ...columns }));
}

/** Add a card to an account, change one by `id`, or delete it when `columns` is null. */
export async function saveCard(
  accountId: string,
  id: string | undefined,
  columns: { last4: string; card_label: string | null } | null,
): Promise<void> {
  const table = supabase.from("money_cards");
  if (!columns) check(await table.delete().eq("id", id!));
  else if (id) check(await table.update(columns).eq("id", id));
  else check(await table.insert({ account_id: accountId, ...columns }));
}
