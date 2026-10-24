import type {
  MoneyCurrency,
  MoneyTransactionCard,
  MoneyTransactionFeedFilters,
  MoneyTransactionFeedItem,
  MoneyTransactionFeedSummary,
} from "./money";

/**
 * The transaction feed apart from the screens that draw it: the web page and the phone ask the
 * database the same way and show what comes back the same way.
 */

export const MONEY_FEED_PAGE_SIZE = 50;

export function formatMoney(
  amount: number,
  currency: MoneyCurrency | string,
  locale: string,
): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeCurrency = (currency || "RUB").toString().toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(safeAmount);
  } catch {
    return `${safeAmount.toFixed(2)} ${safeCurrency}`;
  }
}

/** What `money_list_transactions_feed` and `money_transaction_feed_summary` are asked, by filter. */
export function moneyFeedArgs(payerPersonId: string, filters: MoneyTransactionFeedFilters) {
  return {
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
  };
}

/** A feed row as the screens read it: its card, line-item titles and categories always present. */
export function normalizeFeedItem(item: Record<string, unknown>): MoneyTransactionFeedItem {
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

/** The rows `money_transaction_feed_summary` returns, one per currency, as numbers. */
export function feedSummaryOf(data: unknown): MoneyTransactionFeedSummary {
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const byCurrency = rows.map((row) => ({
    currency: String(row.currency ?? ""),
    count: Number(row.total_count ?? 0),
    positiveAmount: Number(row.total_positive_amount ?? 0),
    negativeAmount: Number(row.total_negative_amount ?? 0),
  }));
  return {
    totalCount: byCurrency.reduce((sum, one) => sum + one.count, 0),
    byCurrency,
  };
}

/** The comment a row shows: the person's own, else the bank's. */
export function preferredComment(
  comment: string | null | undefined,
  sourceComment: string | null | undefined,
): string | null {
  return comment?.trim() || sourceComment?.trim() || null;
}
