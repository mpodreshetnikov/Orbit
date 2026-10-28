import { z } from "zod";
import { readTimezonePreference } from "@/lib/medications/regenerate-dose-events";
import { isValidTimeZone, localDayEndUtc, localDayStartUtc } from "../local-day";
import {
  MONEY_FEED_MAX_LIMIT,
  listMoneyAccounts,
  listMoneyCategories,
  listMoneyTransactions,
  resolveCategoryFilter,
  type MoneyTransactionView,
} from "../money/transactions";
import { dateRangeSchema, personSelectorSchema, uuidSchema } from "../schemas/common";
import { withPerson, withUserClient } from "../tool-context";
import { fail, ok, summarizeList, summarizePage } from "../tool-result";
import { zonedDate } from "../zoned-time";
import { MONEY_READ_SCOPE } from "./scopes";
import type { McpToolServer } from "./types";

/**
 * Read-only money tools (T-261028-w8i): the ledger, its accounts and its
 * categories. Nothing here writes; every tool is annotated read-only and needs
 * the `money:read` grant, which a health-only connection does not have.
 *
 * Transactions belong to a payer person, so the ledger tool resolves a person
 * the way the health tools do. Card and account numbers are never returned:
 * accounts are named by their label, cards by theirs.
 */

const TRANSACTION_TYPES = ["expense", "income", "transfer", "refund", "fee", "adjustment"] as const;
const TRANSACTION_STATUSES = ["posted", "pending", "cancelled"] as const;

function formatAmount(amount: number, currency: string): string {
  return `${amount > 0 ? "+" : ""}${amount.toFixed(2)} ${currency}`;
}

function transactionLine(transaction: MoneyTransactionView, timeZone: string): string {
  const party = transaction.counterparty.name ?? transaction.merchant_name ?? "unknown";
  const categories = [
    ...new Set(transaction.line_items.map((item) => item.category?.name).filter(Boolean)),
  ];
  return (
    `${zonedDate(transaction.posted_at, timeZone)} ${formatAmount(transaction.amount, transaction.currency)}` +
    ` ${transaction.counterparty.direction} ${party}` +
    ` [${categories.join(", ") || "uncategorized"}]` +
    (transaction.line_items.length > 1 ? ` (${transaction.line_items.length} lines)` : "") +
    ` — ${transaction.bank}, ${transaction.account.label}`
  );
}

export function registerMoneyTools(server: McpToolServer): void {
  server.registerTool(
    "list_money_transactions",
    {
      title: "List money transactions",
      description:
        "List a person's bank and manual money transactions, newest first, with the same filters and search as the web ledger. Each transaction carries the bank and account it came from, the counterparty (who the money came from or went to, the channel, and their bank when the bank reports it), the bank's own category and MCC, the comment, and its composition: every line item (receipt line) with amount and Orbit category, including the canonical category key. Use list_money_categories and list_money_accounts to find the names and ids the filters accept.",
      inputSchema: z.object({
        ...personSelectorSchema,
        ...dateRangeSchema,
        search: z
          .string()
          .optional()
          .describe(
            "Free text matched against merchant, comments and receipt line titles, case-insensitively.",
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
        transfers: z
          .enum(["all", "only", "exclude"])
          .default("all")
          .describe("Keep, keep only, or drop transfers between people and own accounts."),
        include_bank_payload: z
          .boolean()
          .default(false)
          .describe(
            "Also return the bank's own operation record (numbers removed). Large; ask only when the summary fields are not enough.",
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone the from/to dates and the listed dates are in. Defaults to the user's saved preference, or UTC.",
          ),
        limit: z.number().int().min(1).max(MONEY_FEED_MAX_LIMIT).default(50),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    withPerson(async (supabase, person, args, auth) => {
      const requestedZone = args.timezone?.trim() || null;
      if (requestedZone && !isValidTimeZone(requestedZone)) {
        return fail(
          `"${args.timezone}" is not a timezone this server recognises. Pass an IANA name like "Europe/Moscow".`,
        );
      }
      const timeZone =
        requestedZone ?? (await readTimezonePreference(supabase, auth.authUserId)) ?? "UTC";

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
      };

      const page = await listMoneyTransactions(
        supabase,
        { ...query, offset: args.offset, limit: args.limit },
        categories,
        args.include_bank_payload,
      );

      // Every feed row carries the filtered total, so an empty page past the end has none to read.
      // Ask for one row from the start to tell "nothing matches" apart from "offset too far".
      const total =
        page.transactions.length === 0 && args.offset > 0
          ? (await listMoneyTransactions(supabase, { ...query, offset: 0, limit: 1 }, categories))
              .total
          : page.total;
      const hasMore = args.offset + page.transactions.length < total;

      return ok(
        summarizePage(
          `transactions for ${person.name} (dates in ${timeZone})`,
          page.transactions.map((transaction) => transactionLine(transaction, timeZone)),
          {
            total,
            offset: args.offset,
            has_more: hasMore,
            next_offset: hasMore ? args.offset + page.transactions.length : null,
          },
        ),
        {
          person,
          timezone: timeZone,
          total,
          offset: args.offset,
          next_offset: hasMore ? args.offset + page.transactions.length : null,
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
        : all.filter((category) => !category.archived_at);
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
