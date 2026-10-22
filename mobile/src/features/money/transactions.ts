import type {
  CreateMoneyLineItemInput,
  CreateMoneyTransactionInput,
  MoneyLineItem,
  MoneyTransactionCard,
  MoneyTransactionDetail,
  UpdateMoneyTransactionInput,
} from "@orbit-types/money";
import {
  lineItemChanges,
  lineItemRow,
  lineItemsOrWhole,
  merchantNames,
  transactionInsertRow,
} from "@orbit-types/money-transaction-form";
import { supabase } from "@/lib/supabase";

/** A transaction with its line items and card, as its page shows it. */
export type TransactionDetail = MoneyTransactionDetail & {
  money_cards: MoneyTransactionCard | null;
};

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

// The rows are the shared builders' shapes of the generated insert types.
const asRow = <T>(row: T) => row as never;

/** One transaction with its line items, or null when it is not there. */
export async function fetchTransaction(id: string): Promise<TransactionDetail | null> {
  const rows = check(
    await supabase
      .from("money_transactions")
      .select("*, money_cards(id, last4, card_label), money_line_items(*)")
      .eq("id", id),
  ) as unknown as (TransactionDetail & { money_line_items: MoneyLineItem[] | null })[];
  const row = rows?.[0];
  if (!row) return null;
  const { money_line_items, ...transaction } = row;
  return { ...transaction, line_items: money_line_items ?? [] };
}

/** Add a transaction with its line items, or one for the whole amount; its id. */
export async function createTransaction(
  transaction: CreateMoneyTransactionInput,
  lineItems: CreateMoneyLineItemInput[],
): Promise<string> {
  const [row] = check(
    await supabase
      .from("money_transactions")
      .insert(asRow(transactionInsertRow(transaction)))
      .select("id"),
  ) as { id: string }[];
  const items = lineItemsOrWhole(lineItems, transaction.merchant_name, transaction.amount);
  check(
    await supabase
      .from("money_line_items")
      .insert(asRow(items.map((item) => lineItemRow(item, row.id)))),
  );
  return row.id;
}

/** Change a transaction and bring its saved line items to the ones given. */
export async function updateTransaction(
  id: string,
  updates: UpdateMoneyTransactionInput,
  lineItems: CreateMoneyLineItemInput[],
): Promise<void> {
  check(await supabase.from("money_transactions").update(asRow(updates)).eq("id", id));
  const items = lineItemsOrWhole(lineItems, updates.merchant_name, updates.amount ?? 0);
  const current = check(
    await supabase.from("money_line_items").select("id").eq("transaction_id", id),
  ) as { id: string }[];
  const { removed, changed, added } = lineItemChanges(
    current.map((one) => one.id),
    items,
  );
  if (removed.length > 0) {
    check(await supabase.from("money_line_items").delete().in("id", removed));
  }
  for (const item of changed) {
    check(
      await supabase
        .from("money_line_items")
        .update(asRow(lineItemRow(item, id)))
        .eq("id", item.id!),
    );
  }
  if (added.length > 0) {
    check(
      await supabase
        .from("money_line_items")
        .insert(asRow(added.map((item) => lineItemRow(item, id)))),
    );
  }
}

export async function deleteTransaction(id: string): Promise<void> {
  check(await supabase.from("money_transactions").delete().eq("id", id));
}

/** Each merchant's usual category, by name. */
export async function fetchMerchantCategories(personId: string): Promise<Record<string, string>> {
  const rows = check(
    await supabase.rpc("get_money_merchant_default_categories", { p_payer_person_id: personId }),
  ) as { merchant_name: string; category_id: string }[] | null;
  return Object.fromEntries((rows ?? []).map((row) => [row.merchant_name, row.category_id]));
}

/** The merchants the person has paid, for the form's suggestions. */
export async function fetchMerchantNames(personId: string): Promise<string[]> {
  const rows = check(
    await supabase
      .from("money_transactions")
      .select("merchant_name")
      .eq("payer_person_id", personId),
  ) as { merchant_name: string | null }[];
  return merchantNames(rows ?? []);
}

/** The household, humans first, for a line item's beneficiary. */
export async function fetchPersons(): Promise<{ id: string; name: string }[]> {
  const rows = check(
    await supabase
      .from("persons")
      .select("id, name")
      .order("kind", { ascending: true })
      .order("name", { ascending: true }),
  );
  return (rows ?? []) as { id: string; name: string }[];
}
