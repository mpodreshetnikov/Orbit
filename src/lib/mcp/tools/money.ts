import { z } from "zod";
import { readTimezonePreference } from "@/lib/medications/regenerate-dose-events";
import { isValidTimeZone, localDayEndUtc, localDayStartUtc } from "../local-day";
import {
  MONEY_FEED_MAX_LIMIT,
  MONEY_MCP_DEFAULT_LIMIT,
  MONEY_MCP_DETAIL_MAX_IDS,
  MONEY_MCP_LINE_SEARCH_DEFAULT_LIMIT,
  MONEY_MCP_LINE_SEARCH_MAX_LIMIT,
  compactTransactionsFromPage,
  getMoneyTransactionDetails,
  listMoneyAccounts,
  listMoneyCategories,
  listMoneyTransactions,
  resolveCategoryFilter,
  searchMoneyLineItems,
  type MoneyTransactionCompactView,
} from "../money/transactions";
import { dateRangeSchema, personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson, withUserClient } from "../tool-context";
import { fail, ok, summarizeList, summarizePage } from "../tool-result";
import { zonedDate } from "../zoned-time";
import { MONEY_READ_SCOPE } from "./scopes";
import type { McpToolServer } from "./types";

/**
 * Read-only money tools: wide ledger list, detail-by-ids, line-item search,
 * accounts and categories. Nothing here writes; every tool needs `money:read`.
 *
 * Agent steer: start with `list_money_transactions` (wide, no lines) or
 * `search_money_line_items` (receipt text), then `get_money_transaction_details`
 * only for the ids whose composition you need.
 */

const TRANSACTION_TYPES = ["expense", "income", "transfer", "refund", "fee", "adjustment"] as const;
const TRANSACTION_STATUSES = ["posted", "pending", "cancelled"] as const;

function formatAmount(amount: number, currency: string): string {
  return `${amount > 0 ? "+" : ""}${amount.toFixed(2)} ${currency}`;
}

function compactLine(transaction: MoneyTransactionCompactView, timeZone: string): string {
  const party = transaction.counterparty.name ?? transaction.merchant_name ?? "unknown";
  const categories = transaction.category_keys.length
    ? transaction.category_keys.join(", ")
    : "uncategorized";
  return (
    `${zonedDate(transaction.posted_at, timeZone)} ${formatAmount(transaction.amount, transaction.currency)}` +
    ` ${transaction.counterparty.direction} ${party}` +
    ` [${categories}]` +
    (transaction.line_item_count > 1 ? ` (${transaction.line_item_count} lines)` : "") +
    ` — ${transaction.bank}, ${transaction.account.label}`
  );
}

async function resolveMoneyTimezone(
  supabase: Parameters<typeof readTimezonePreference>[0],
  authUserId: string,
  requestedZone: string | null | undefined,
): Promise<{ timeZone: string } | { error: string }> {
  // Blank / whitespace must not win over the saved preference via `??`.
  const normalizedZone = requestedZone?.trim() || null;
  if (normalizedZone && !isValidTimeZone(normalizedZone)) {
    return {
      error: `"${requestedZone}" is not a timezone this server recognises. Pass an IANA name like "Europe/Moscow".`,
    };
  }
  const preferredZone = normalizedZone ? null : await readTimezonePreference(supabase, authUserId);
  return { timeZone: normalizedZone ?? preferredZone ?? "UTC" };
}

export function registerMoneyTools(server: McpToolServer): void {
  server.registerTool(
    "list_money_transactions",
    {
      title: "List money transactions (wide)",
      description:
        "Wide compact ledger for a person: date, amount, account, category keys, counterparty/description, line_item_count — no receipt lines. Prefer this (or search_money_line_items) first; call get_money_transaction_details only for ids whose composition you need. Newest first; filters match the web ledger (period, accounts, categories, types, amount bounds, description/merchant search). Pages with limit/offset and has_more / next_offset. Default limit 100 (max 200). Use list_money_categories and list_money_accounts for filter names/ids.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...dateRangeSchema,
        search: z
          .string()
          .optional()
          .describe(
            "Free text on merchant, comments and receipt line titles (case-insensitive). For “find milk on receipts”, prefer search_money_line_items.",
          ),
        categories: z
          .array(z.string())
          .optional()
          .describe(
            'Categories by id, canonical key (e.g. "food", "transport", "uncategorized") or name; subcategories are included.',
          ),
        account_ids: z.array(uuidSchema).optional().describe("Restrict to these accounts."),
        transaction_types: z.array(z.enum(TRANSACTION_TYPES)).optional(),
        statuses: z.array(z.enum(TRANSACTION_STATUSES)).optional(),
        direction: z
          .enum(["all", "income", "expense"])
          .default("all")
          .describe("income = money in (amount > 0), expense = money out (amount < 0)."),
        amount_min: z
          .number()
          .min(0)
          .optional()
          .describe(
            "Smallest amount to include, by size whatever the sign: 1000 keeps a -1500 purchase and a +1500 income. Combine with direction for one side.",
          ),
        amount_max: z
          .number()
          .min(0)
          .optional()
          .describe("Largest amount to include, by size whatever the sign; inclusive."),
        transfers: z
          .enum(["all", "only", "exclude"])
          .default("all")
          .describe("Keep, keep only, or drop transfers between people and own accounts."),
        include_bank_payload: z
          .boolean()
          .default(false)
          .describe(
            "Also return the bank's own operation record (numbers removed). Large; ask only when the summary fields are not enough. Requires the feed to load raw_payload — prefer leave false on wide pages.",
          ),
        sort: z
          .enum(["posted_at_desc"])
          .default("posted_at_desc")
          .describe(
            "Order of the page. Only newest-first is implemented today; additional values can be added later without renaming this field.",
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone the from/to dates and the listed dates are in. Defaults to the user's saved preference, or UTC.",
          ),
        limit: z.number().int().min(1).max(MONEY_FEED_MAX_LIMIT).default(MONEY_MCP_DEFAULT_LIMIT),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args, auth) => {
      const zone = await resolveMoneyTimezone(supabase, auth.authUserId, args.timezone?.trim());
      if ("error" in zone) return fail(zone.error);
      const { timeZone } = zone;

      if (
        args.amount_min !== undefined &&
        args.amount_max !== undefined &&
        args.amount_min > args.amount_max
      ) {
        return fail(
          `amount_min (${args.amount_min}) is above amount_max (${args.amount_max}); nothing could match.`,
        );
      }

      const categories = await listMoneyCategories(supabase);

      let categoryIds: string[] | undefined;
      if (args.categories?.length) {
        const resolved = resolveCategoryFilter(categories, args.categories);
        if (resolved.unknown.length > 0) {
          return fail(
            `No category matches ${resolved.unknown.map((ref) => `"${ref}"`).join(", ")}. Call list_money_categories for the names, keys and ids that exist.`,
          );
        }
        categoryIds = resolved.ids;
      }

      const query = {
        payerPersonId: person.id,
        search: args.search,
        accountIds: args.account_ids,
        transactionTypes: args.transaction_types,
        statuses: args.statuses,
        categoryIds,
        transfers: args.transfers,
        amountSign: args.direction,
        fromUtc: args.from ? localDayStartUtc(args.from, timeZone) : undefined,
        toUtc: args.to ? localDayEndUtc(args.to, timeZone) : undefined,
        amountMin: args.amount_min,
        amountMax: args.amount_max,
      };

      // Wide list: skip line jsonb in SQL. raw_payload stays so counterparty/MCC survive.
      const page = await listMoneyTransactions(
        supabase,
        { ...query, offset: args.offset, limit: args.limit },
        categories,
        {
          includeBankOperation: args.include_bank_payload,
          includeLineItems: false,
        },
      );

      const total =
        page.transactions.length === 0 && args.offset > 0
          ? (
              await listMoneyTransactions(supabase, { ...query, offset: 0, limit: 1 }, categories, {
                includeLineItems: false,
              })
            ).total
          : page.total;
      const hasMore = args.offset + page.transactions.length < total;
      const nextOffset = hasMore ? args.offset + page.transactions.length : null;
      const transactions = compactTransactionsFromPage(page);

      return ok(
        summarizePage(
          `transactions for ${person.name} (dates in ${timeZone})`,
          transactions.map((transaction) => compactLine(transaction, timeZone)),
          {
            total,
            offset: args.offset,
            has_more: hasMore,
            next_offset: nextOffset,
          },
        ),
        {
          person,
          timezone: timeZone,
          total,
          offset: args.offset,
          limit: args.limit,
          has_more: hasMore,
          next_offset: nextOffset,
          sort: args.sort,
          transactions,
        },
      );
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "get_money_transaction_details",
    {
      title: "Money transaction details (line items)",
      description:
        "Return receipt line items for a batch of transaction ids from list_money_transactions or search_money_line_items. Do not call this for every row of a wide list — only for ids whose composition you need. Max 50 ids per call; paginate the id list yourself if longer.",
      inputSchema: z.object({
        ...personSelectorSchema,
        transaction_ids: z
          .array(uuidSchema)
          .min(1)
          .max(MONEY_MCP_DETAIL_MAX_IDS)
          .describe("Transaction ids to expand. Cap 50 per call."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args) => {
      const categories = await listMoneyCategories(supabase);
      const transactions = await getMoneyTransactionDetails(
        supabase,
        person.id,
        args.transaction_ids,
        categories,
      );
      return ok(
        summarizeList(
          `transaction details for ${person.name}`,
          transactions.map(
            (transaction) =>
              `${transaction.id} ${formatAmount(transaction.amount, transaction.currency)}` +
              ` ${transaction.merchant_name ?? "unknown"}` +
              ` (${transaction.line_items.length} lines)`,
          ),
          transactions.length,
          MONEY_MCP_DETAIL_MAX_IDS,
        ),
        {
          person,
          requested: args.transaction_ids.length,
          returned: transactions.length,
          transactions,
        },
      );
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "search_money_line_items",
    {
      title: "Search money receipt lines",
      description:
        "Find transactions by receipt line text (e.g. “молоко”, case-insensitive, Cyrillic-friendly). Returns matching transactions with only the matching lines — use this instead of walking the wide list when the question is about a product/line. Optional period; pages with limit/offset. Then get_money_transaction_details if you need the full receipt for a hit.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...dateRangeSchema,
        query: z
          .string()
          .min(1)
          .describe("Substring matched against receipt line titles (ILIKE, case-insensitive)."),
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone for from/to and listed dates. Defaults to the user's saved preference, or UTC.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MONEY_MCP_LINE_SEARCH_MAX_LIMIT)
          .default(MONEY_MCP_LINE_SEARCH_DEFAULT_LIMIT),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args, auth) => {
      const zone = await resolveMoneyTimezone(supabase, auth.authUserId, args.timezone?.trim());
      if ("error" in zone) return fail(zone.error);
      const { timeZone } = zone;
      const categories = await listMoneyCategories(supabase);
      const page = await searchMoneyLineItems(
        supabase,
        {
          payerPersonId: person.id,
          search: args.query,
          fromUtc: args.from ? localDayStartUtc(args.from, timeZone) : undefined,
          toUtc: args.to ? localDayEndUtc(args.to, timeZone) : undefined,
          offset: args.offset,
          limit: args.limit,
        },
        categories,
      );

      const total =
        page.transactions.length === 0 && args.offset > 0
          ? (
              await searchMoneyLineItems(
                supabase,
                {
                  payerPersonId: person.id,
                  search: args.query,
                  fromUtc: args.from ? localDayStartUtc(args.from, timeZone) : undefined,
                  toUtc: args.to ? localDayEndUtc(args.to, timeZone) : undefined,
                  offset: 0,
                  limit: 1,
                },
                categories,
              )
            ).total
          : page.total;
      const hasMore = args.offset + page.transactions.length < total;
      const nextOffset = hasMore ? args.offset + page.transactions.length : null;

      return ok(
        summarizePage(
          `line-item hits for ${person.name} matching “${args.query}” (dates in ${timeZone})`,
          page.transactions.map((transaction) => {
            const titles = transaction.matching_line_items.map((item) => item.title).join(", ");
            return (
              `${zonedDate(transaction.posted_at, timeZone)} ${formatAmount(transaction.amount, transaction.currency)}` +
              ` ${transaction.merchant_name ?? "unknown"} — ${titles}`
            );
          }),
          {
            total,
            offset: args.offset,
            has_more: hasMore,
            next_offset: nextOffset,
          },
        ),
        {
          person,
          timezone: timeZone,
          query: args.query,
          total,
          offset: args.offset,
          limit: args.limit,
          has_more: hasMore,
          next_offset: nextOffset,
          transactions: page.transactions,
        },
      );
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "list_money_accounts",
    {
      title: "List money accounts",
      description:
        "List a person's money accounts (bank cards, debit and credit accounts, cash) with their ids, for filtering list_money_transactions by account.",
      inputSchema: z.object({ ...personSelectorSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person) => {
      const accounts = await listMoneyAccounts(supabase, person.id);
      return ok(
        summarizeList(
          `accounts for ${person.name}`,
          accounts.map(
            (account) =>
              `${account.account_label} (${account.account_kind}, ${account.currency}, ${account.source})` +
              (account.is_active ? "" : " — inactive") +
              ` id ${account.id}`,
          ),
          accounts.length,
          100,
        ),
        { person, accounts },
      );
    }, MONEY_READ_SCOPE),
  );

  server.registerTool(
    "list_money_categories",
    {
      title: "List money categories",
      description:
        "List the money categories: the canonical ones every transaction rolls up to (with their keys, e.g. food, transport) and the user's own subcategories under them.",
      inputSchema: z.object({
        include_archived: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withUserClient(async (supabase, args: { include_archived: boolean }) => {
      const all = await listMoneyCategories(supabase);
      const categories = args.include_archived
        ? all
        : all.filter((category) => category.archived_at == null);
      const byId = new Map(all.map((category) => [category.id, category]));
      return ok(
        summarizeList(
          "money categories",
          categories.map((category) => {
            const parent = category.parent_id ? byId.get(category.parent_id) : null;
            return (
              `${category.name_ru} / ${category.name_en}` +
              (category.system_key ? ` (key ${category.system_key})` : "") +
              (parent ? ` under ${parent.name_ru}` : "") +
              ` id ${category.id}`
            );
          }),
          categories.length,
          200,
        ),
        {
          categories: categories.map((category) => ({
            ...category,
            canonical_key: byId.get(category.canonical_category_id)?.system_key ?? null,
          })),
        },
      );
    }, MONEY_READ_SCOPE),
  );
}
