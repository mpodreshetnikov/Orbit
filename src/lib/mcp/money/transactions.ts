import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { describeCounterparty, sanitizeBankOperation, type Counterparty } from "./counterparty";

/**
 * Read side of the money domain for the MCP tools.
 *
 * Transactions are listed through `money_list_transactions_feed`, the RPC the
 * web ledger pages through, so a filter or a search means here exactly what it
 * means on /money/transactions. It runs as the caller (SECURITY INVOKER), so the
 * user-scoped client's RLS decides what is visible, the same as in the app.
 */

type Client = SupabaseClient<Database>;
type FeedRow = Database["public"]["Functions"]["money_list_transactions_feed"]["Returns"][number];
export type MoneyTransactionType = Database["public"]["Enums"]["money_transaction_type"];
export type MoneyTransactionStatus = Database["public"]["Enums"]["money_transaction_status"];

/** The feed RPC refuses more than this per page. */
export const MONEY_FEED_MAX_LIMIT = 200;

export interface MoneyCategory {
  id: string;
  parent_id: string | null;
  canonical_category_id: string;
  category_kind: Database["public"]["Enums"]["money_category_kind"];
  system_key: string | null;
  name_en: string;
  name_ru: string;
  archived_at: string | null;
}

export interface MoneyAccount {
  id: string;
  account_label: string;
  account_kind: string;
  currency: string;
  source: string;
  is_active: boolean;
}

export async function listMoneyCategories(supabase: Client): Promise<MoneyCategory[]> {
  const { data, error } = await supabase
    .from("money_categories")
    .select(
      "id, parent_id, canonical_category_id, category_kind, system_key, name_en, name_ru, archived_at",
    )
    .order("depth", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as MoneyCategory[];
}

export async function listMoneyAccounts(
  supabase: Client,
  ownerPersonId: string,
): Promise<MoneyAccount[]> {
  const { data, error } = await supabase
    .from("money_accounts")
    .select("id, account_label, account_kind, currency, source, is_active")
    .eq("owner_person_id", ownerPersonId)
    .order("account_label", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as MoneyAccount[];
}

/**
 * Resolves what a caller named as categories -- ids, canonical keys like
 * `food`, or names in either language -- to the ids the feed filters on,
 * subcategories included: asking for "food" means every expense filed under it,
 * not only the line items filed on the root itself, which is what the RPC's
 * exact-id match alone would return.
 */
export function resolveCategoryFilter(
  categories: MoneyCategory[],
  refs: string[],
): { ids: string[]; unknown: string[] } {
  const ids = new Set<string>();
  const unknown: string[] = [];
  const childrenOf = new Map<string, string[]>();
  for (const category of categories) {
    // A custom category saved straight under a canonical one carries only `canonical_category_id`
    // (`categoryColumns` in src/types/money-categories.ts); the web tree hangs it off that root,
    // and so does this.
    const parentId =
      category.parent_id ??
      (category.canonical_category_id !== category.id ? category.canonical_category_id : null);
    if (!parentId) continue;
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), category.id]);
  }

  const addWithDescendants = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const child of childrenOf.get(id) ?? []) addWithDescendants(child);
  };

  for (const ref of refs) {
    const needle = ref.trim().toLowerCase();
    const matches = categories.filter(
      (category) =>
        category.id === ref.trim() ||
        category.system_key?.toLowerCase() === needle ||
        category.name_en.toLowerCase() === needle ||
        category.name_ru.toLowerCase() === needle,
    );
    if (matches.length === 0) unknown.push(ref);
    for (const match of matches) addWithDescendants(match.id);
  }

  return { ids: [...ids], unknown };
}

export interface MoneyFeedQuery {
  payerPersonId: string;
  search?: string;
  accountIds?: string[];
  transactionTypes?: MoneyTransactionType[];
  statuses?: MoneyTransactionStatus[];
  categoryIds?: string[];
  transfers?: "all" | "only" | "exclude";
  amountSign?: "all" | "income" | "expense";
  fromUtc?: string;
  toUtc?: string;
  /** Bounds on the amount's size, whatever its sign; `amountSign` picks the side. */
  amountMin?: number;
  amountMax?: number;
  offset: number;
  limit: number;
}

export interface MoneyLineItemView {
  title: string;
  amount: number;
  quantity: number | null;
  unit: string | null;
  status: string | null;
  category: { id: string; name: string; canonical_key: string | null } | null;
  assignment_method: string | null;
}

export interface MoneyTransactionView {
  id: string;
  posted_at: string;
  amount: number;
  currency: string;
  transaction_type: MoneyTransactionType;
  status: MoneyTransactionStatus;
  merchant_name: string | null;
  /** Where the record came from: the bank connector (`tbank`), a file import, or `manual`. */
  bank: string;
  account: { id: string; label: string; kind: string };
  card_label: string | null;
  counterparty: Counterparty;
  is_transfer: boolean;
  mcc: string | null;
  bank_category: string | null;
  comment: string | null;
  cashback: { amount: number; currency: string | null } | null;
  /** What the transaction is made of: one line for a plain purchase, one per receipt line otherwise. */
  line_items: MoneyLineItemView[];
  bank_operation?: Record<string, unknown> | null;
}

export interface MoneyFeedPage {
  total: number;
  transactions: MoneyTransactionView[];
}

const SOURCE_LABELS: Record<string, string> = { tbank: "T-Bank" };

function categoryView(
  categoryId: unknown,
  byId: Map<string, MoneyCategory>,
): MoneyLineItemView["category"] {
  if (typeof categoryId !== "string") return null;
  const category = byId.get(categoryId);
  if (!category) return { id: categoryId, name: categoryId, canonical_key: null };
  const root = byId.get(category.canonical_category_id);
  return {
    id: category.id,
    name: category.name_ru || category.name_en,
    canonical_key: root?.system_key ?? category.system_key,
  };
}

function lineItemsOf(row: FeedRow, byId: Map<string, MoneyCategory>): MoneyLineItemView[] {
  const raw = Array.isArray(row.line_items) ? (row.line_items as Record<string, unknown>[]) : [];
  return raw.map((item) => ({
    title: String(item.title ?? ""),
    amount: Number(item.amount),
    quantity: item.quantity == null ? null : Number(item.quantity),
    unit: typeof item.unit === "string" ? item.unit : null,
    status: typeof item.line_status === "string" ? item.line_status : null,
    category: categoryView(item.category_id, byId),
    assignment_method: typeof item.assignment_method === "string" ? item.assignment_method : null,
  }));
}

export function toTransactionView(
  row: FeedRow,
  byId: Map<string, MoneyCategory>,
  includeBankOperation: boolean,
): MoneyTransactionView {
  const amount = Number(row.amount);
  return {
    id: row.id,
    posted_at: row.posted_at,
    amount,
    currency: row.currency,
    transaction_type: row.transaction_type,
    status: row.status,
    merchant_name: row.merchant_name,
    bank: SOURCE_LABELS[row.source] ?? row.source,
    account: { id: row.account_id, label: row.account_label, kind: row.account_kind },
    card_label: row.card_label ?? null,
    counterparty: describeCounterparty({
      amount,
      is_transfer: row.is_transfer,
      merchant_name: row.merchant_name,
      raw_payload: row.raw_payload,
    }),
    is_transfer: row.is_transfer,
    mcc: mccFromPayload(row.raw_payload),
    bank_category: row.source_category_name ?? null,
    comment: row.comment ?? row.source_comment ?? null,
    cashback:
      row.cashback_amount == null
        ? null
        : { amount: Number(row.cashback_amount), currency: row.cashback_currency ?? null },
    line_items: lineItemsOf(row, byId),
    ...(includeBankOperation ? { bank_operation: sanitizeBankOperation(row.raw_payload) } : {}),
  };
}

/** The feed RPC does not return `mcc`; the bank's payload carries it for imported rows. */
function mccFromPayload(rawPayload: unknown): string | null {
  const operation =
    rawPayload && typeof rawPayload === "object"
      ? ((rawPayload as Record<string, unknown>).operation as Record<string, unknown> | undefined)
      : undefined;
  const value = operation?.mccString ?? operation?.mcc;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

export async function listMoneyTransactions(
  supabase: Client,
  query: MoneyFeedQuery,
  categories: MoneyCategory[],
  includeBankOperation = false,
): Promise<MoneyFeedPage> {
  const { data, error } = await supabase.rpc("money_list_transactions_feed", {
    p_payer_person_id: query.payerPersonId,
    p_search: query.search?.trim() || undefined,
    p_account_ids: query.accountIds?.length ? query.accountIds : undefined,
    p_transaction_types: query.transactionTypes?.length ? query.transactionTypes : undefined,
    p_statuses: query.statuses?.length ? query.statuses : undefined,
    p_category_ids: query.categoryIds?.length ? query.categoryIds : undefined,
    p_transfer_filter: query.transfers ?? "all",
    p_amount_sign: query.amountSign ?? "all",
    p_from: query.fromUtc,
    p_to: query.toUtc,
    p_amount_min: query.amountMin,
    p_amount_max: query.amountMax,
    p_offset: query.offset,
    p_limit: Math.min(query.limit, MONEY_FEED_MAX_LIMIT),
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as FeedRow[];
  const byId = new Map(categories.map((category) => [category.id, category]));
  return {
    // Every row carries the filtered total; an empty page past the end has none, so it reads 0
    // there and the caller's offset message says so.
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    transactions: rows.map((row) => toTransactionView(row, byId, includeBankOperation)),
  };
}
