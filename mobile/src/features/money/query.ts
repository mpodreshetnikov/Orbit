import type {
  MoneyAccount,
  MoneyCategory,
  MoneyTransactionFeedFilters,
  MoneyTransactionFeedPage,
  MoneyTransactionFeedSummary,
} from "@orbit-types/money";
import { sortMoneyCategories } from "@orbit-types/money-categories";
import {
  feedSummaryOf,
  MONEY_FEED_PAGE_SIZE,
  moneyFeedArgs,
  normalizeFeedItem,
} from "@orbit-types/money-feed";
import { supabase } from "@/lib/supabase";

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** One page of the person's transactions, newest first, as the web feed asks for it. */
export async function fetchMoneyFeedPage(
  personId: string,
  filters: MoneyTransactionFeedFilters,
  offset: number,
): Promise<MoneyTransactionFeedPage> {
  const data = check(
    await supabase.rpc(
      "money_list_transactions_feed",
      // Nulls, as the web sends them: the generated types know only omitted arguments.
      {
        ...moneyFeedArgs(personId, filters),
        p_offset: offset,
        p_limit: MONEY_FEED_PAGE_SIZE,
      } as never,
    ),
  ) as unknown;
  const items = Array.isArray(data)
    ? data.map((item) => normalizeFeedItem(item as Record<string, unknown>))
    : [];
  return {
    items,
    nextOffset: items.length === MONEY_FEED_PAGE_SIZE ? offset + items.length : null,
  };
}

/** How many transactions match, and their sums in and out. */
export async function fetchMoneyFeedSummary(
  personId: string,
  filters: MoneyTransactionFeedFilters,
): Promise<MoneyTransactionFeedSummary> {
  return feedSummaryOf(
    check(
      await supabase.rpc(
        "money_transaction_feed_summary",
        moneyFeedArgs(personId, filters) as never,
      ),
    ),
  );
}

/** The person's accounts, active first, by name. */
export async function fetchMoneyAccounts(personId: string): Promise<MoneyAccount[]> {
  const rows = check(
    await supabase
      .from("money_accounts")
      .select("*")
      .eq("owner_person_id", personId)
      .order("is_active", { ascending: false })
      .order("account_label", { ascending: true }),
  );
  return (rows ?? []) as MoneyAccount[];
}

/** Every category, in the web lists' order. */
export async function fetchMoneyCategories(): Promise<MoneyCategory[]> {
  const rows = check(await supabase.from("money_categories").select("*"));
  return sortMoneyCategories((rows ?? []) as MoneyCategory[]);
}
