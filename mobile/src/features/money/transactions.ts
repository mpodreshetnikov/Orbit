import type {
  MoneyLineItem,
  MoneyTransactionCard,
  MoneyTransactionDetail,
} from "@orbit-types/money";
import { supabase } from "@/lib/supabase";

/** A transaction with its line items and card, as its page shows it. */
export type TransactionDetail = MoneyTransactionDetail & {
  money_cards: MoneyTransactionCard | null;
};

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

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
