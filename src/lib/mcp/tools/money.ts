import { z } from "zod";
import { readTimezonePreference } from "@/lib/medications/regenerate-dose-events";
import {
  isoDay,
  parsePeriod,
  percentChange,
  periodLabel,
  topCategories,
  type SpendingReport,
} from "@/types/money-spending-report";
import { isValidTimeZone, localDayEndUtc, localDayStartUtc } from "../local-day";
import { fetchMoneySpendingReport } from "../money/spending-report";
import {
  MONEY_FEED_MAX_LIMIT,
  listMoneyAccounts,
  listMoneyCategories,
  listMoneyTransactions,
  resolveCategoryFilter,
  type MoneyCategory,
  type MoneyTransactionView,
} from "../money/transactions";
import {
  dateRangeSchema,
  isoDateSchema,
  personSelectorSchema,
  uuidSchema,
} from "../schemas/common";
import { withPerson, withUserClient } from "../tool-context";
import { fail, ok, summarizeList, summarizePage } from "../tool-result";
import { zonedDate } from "../zoned-time";
import { MONEY_READ_SCOPE } from "./scopes";
import type { McpToolServer } from "./types";

/**
 * Read-only money tools (T-261028-w8i, T-261109-p1i): the ledger, its accounts,
 * its categories, and the spending-report aggregates. Nothing here writes;
 * every tool is annotated read-only and needs the `money:read` grant, which a
 * health-only connection does not have.
 *
 * Transactions belong to a payer person, so the ledger and report tools resolve
 * a person the way the health tools do. Card and account numbers are never
 * returned: accounts are named by their label, cards by theirs.
 */

const TRANSACTION_TYPES = ["expense", "income", "transfer", "refund", "fee", "adjustment"] as const;
const TRANSACTION_STATUSES = ["posted", "pending", "cancelled"] as const;

function formatAmount(amount: number, currency: string): string {
  return `${amount > 0 ? "+" : ""}${amount.toFixed(2)} ${currency}`;
}

function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function formatDelta(value: number, base: number): string {
  const change = percentChange(value, base);
  if (change === null) return "n/a";
  return `${change > 0 ? "+" : ""}${change}%`;
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

/**
 * One category by id, canonical key or name — the report RPC takes a single branch root.
 * Ids and system keys are unique; duplicate display names must be disambiguated by id.
 */
function resolveOneCategory(
  categories: MoneyCategory[],
  ref: string,
):
  | { id: string }
  | { unknown: string }
  | { ambiguous: Array<{ id: string; name_ru: string; name_en: string }> } {
  const trimmed = ref.trim();
  const byId = categories.find((category) => category.id === trimmed);
  if (byId) return { id: byId.id };

  const needle = trimmed.toLowerCase();
  const matches = categories.filter(
    (category) =>
      category.system_key?.toLowerCase() === needle ||
      category.name_en.toLowerCase() === needle ||
      category.name_ru.toLowerCase() === needle,
  );
  if (matches.length === 0) return { unknown: ref };
  if (matches.length > 1) {
    return {
      ambiguous: matches.map((category) => ({
        id: category.id,
        name_ru: category.name_ru,
        name_en: category.name_en,
      })),
    };
  }
  return { id: matches[0]!.id };
}

function summarizeSpendingReport(
  personName: string,
  report: SpendingReport,
  locale: string,
  filterCategoryId: string | null = null,
): string {
  const { totals, currency } = report;
  const period = `${report.period.start}…${report.period.end}`;
  const label = periodLabel(
    { kind: "custom", start: report.period.start, end: report.period.end },
    locale,
  );
  const lines = [
    `spending report for ${personName}: ${label} (${period}, ${currency})`,
    `- income ${formatMoney(totals.income, currency)} (vs previous ${formatDelta(totals.income, totals.previous_income)}, vs last-year avg ${formatDelta(totals.income, totals.last_year_income)})`,
    `- expense ${formatMoney(totals.expense, currency)} (vs previous ${formatDelta(totals.expense, totals.previous_expense)}, vs last-year avg ${formatDelta(totals.expense, totals.last_year_expense)})`,
    `- net ${formatMoney(totals.net, currency)} (vs previous ${formatDelta(totals.net, totals.previous_net)}, vs last-year avg ${formatDelta(totals.net, totals.last_year_net)})`,
  ];
  if (report.forecast) {
    lines.push(
      `- forecast ${formatMoney(report.forecast.expense, currency)} (${report.forecast.days_left} days left)`,
    );
  }
  const categories = topCategories(report.categories, filterCategoryId, "expense").slice(0, 8);
  if (categories.length > 0) {
    lines.push("- top categories:");
    for (const category of categories) {
      lines.push(
        `  - ${category.name_ru} ${formatMoney(category.expense, currency)} (prev ${formatDelta(category.expense, category.previous_expense)})`,
      );
    }
  }
  if (report.merchants.length > 0) {
    lines.push("- top merchants:");
    for (const merchant of report.merchants.slice(0, 5)) {
      lines.push(
        `  - ${merchant.name} ${formatMoney(merchant.expense, currency)} (${merchant.transaction_count} tx)`,
      );
    }
  }
  if (report.fx_status.status !== "ok") {
    lines.push(`- fx ${report.fx_status.status}`);
  }
  return lines.join("\n");
}

export function registerMoneyTools(server: McpToolServer): void {
  server.registerTool(
    "list_money_transactions",
    {
      title: "List money transactions",
      description:
        "List a person's bank and manual money transactions, newest first, with the same filters and search as the web ledger, plus bounds on the amount. Each transaction carries the bank and account it came from, the counterparty (who the money came from or went to, the channel, and their bank when the bank reports it), the bank's own category and MCC, the comment, and its composition: every line item (receipt line) with amount and Orbit category, including the canonical category key. Use list_money_categories and list_money_accounts to find the names and ids the filters accept.",
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
      if (
        args.amount_min !== undefined &&
        args.amount_max !== undefined &&
        args.amount_min > args.amount_max
      ) {
        return fail(
          `amount_min (${args.amount_min}) is above amount_max (${args.amount_max}); nothing could match.`,
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
        amountMin: args.amount_min,
        amountMax: args.amount_max,
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

  server.registerTool(
    "get_money_spending_report",
    {
      title: "Get money spending report",
      description:
        "Return spending-report aggregates for a person and period: income, expense and net with comparisons to the previous period and last year's average, an optional forecast while the period is still running, top categories and top merchants. Uses the same money_get_spending_report read model as the web and phone reports. Does not return the transaction feed — use list_money_transactions for individual rows. Call list_money_accounts / list_money_categories for filter ids.",
      inputSchema: z.object({
        ...personSelectorSchema,
        period: z
          .enum(["week", "month", "last30", "custom"])
          .default("month")
          .describe(
            'Preset period around "today", or custom with from/to. Defaults to the calendar month.',
          ),
        from: isoDateSchema
          .optional()
          .describe("Custom period start (YYYY-MM-DD). Required when period is custom."),
        to: isoDateSchema
          .optional()
          .describe("Custom period end, inclusive (YYYY-MM-DD). Required when period is custom."),
        currency: z
          .string()
          .length(3)
          .default("RUB")
          .describe("Report currency (ISO 4217). Amounts are converted with posting-day FX."),
        account_ids: z
          .array(uuidSchema)
          .optional()
          .describe("Restrict the report to these accounts; omit for all."),
        category: z
          .string()
          .optional()
          .describe(
            "Narrow to one category branch by id, canonical key (e.g. food) or name. Subcategories are included by the report.",
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            'IANA timezone used to decide "today" for presets and the forecast. Defaults to the user\'s saved preference, or UTC.',
          ),
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
      if (args.period === "custom" && (!args.from || !args.to || args.from > args.to)) {
        return fail(
          'A custom period needs from and to as YYYY-MM-DD with from on or before to. Or pass period "week", "month" or "last30".',
        );
      }

      const timeZone =
        requestedZone ?? (await readTimezonePreference(supabase, auth.authUserId)) ?? "UTC";
      // Presets follow the calendar day in the caller's zone, matching how the phone picks "today".
      const todayLocal = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const today = /^\d{4}-\d{2}-\d{2}$/.test(todayLocal) ? todayLocal : isoDay(new Date());
      const resolvedPeriod = parsePeriod(args.period, args.from ?? null, args.to ?? null, today);

      let categoryId: string | null = null;
      if (args.category?.trim()) {
        const categories = await listMoneyCategories(supabase);
        const match = resolveOneCategory(categories, args.category);
        if ("unknown" in match) {
          return fail(
            `No category matches "${args.category}". Call list_money_categories for the names, keys and ids that exist.`,
          );
        }
        if ("ambiguous" in match) {
          const candidates = match.ambiguous
            .map((category) => `${category.name_ru} / ${category.name_en} id ${category.id}`)
            .join("; ");
          return fail(
            `"${args.category}" matches more than one category (${candidates}). Pass the id.`,
            { candidates: match.ambiguous },
          );
        }
        categoryId = match.id;
      }

      const report = await fetchMoneySpendingReport(supabase, {
        personId: person.id,
        period: resolvedPeriod,
        currency: args.currency.toUpperCase(),
        accountIds: args.account_ids ?? [],
        categoryId,
        today,
      });

      return ok(summarizeSpendingReport(person.name, report, "ru-RU", categoryId), {
        person,
        timezone: timeZone,
        period: resolvedPeriod,
        report,
      });
    }, MONEY_READ_SCOPE),
  );
}
