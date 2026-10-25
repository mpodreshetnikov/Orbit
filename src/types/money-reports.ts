import type {
  MoneyBudgetCategoryNode,
  MoneyBudgetChartMode,
  MoneyBudgetFxStatus,
  MoneyBudgetReport,
  MoneyBudgetTarget,
  MoneyBudgetTrendPoint,
} from "./money";

/** The budget report as the web page and the phone read it from `money_get_budget_report`. */

type RpcRow = Record<string, unknown>;
type RpcCategoryRow = Record<string, unknown>;

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function lastDayOfMonth(value: string): string | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return formatIsoDate(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)));
}

export function resolveMoneyFxSyncRange(
  monthStart: string,
  today: Date = new Date(),
): { startDate: string; endDate: string } | null {
  const monthStartDate = parseIsoDate(monthStart);
  const monthEnd = lastDayOfMonth(monthStart);
  if (!monthStartDate || !monthEnd) return null;

  const todayIso = formatIsoDate(today);
  const endDate = monthEnd < todayIso ? monthEnd : todayIso;
  if (endDate < monthStart) return null;

  return {
    startDate: monthStart,
    endDate,
  };
}

export function normalizeBudgetTarget(value: unknown): MoneyBudgetTarget | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = toStringOrNull(row.id);
  const personId = toStringOrNull(row.person_id);
  const categoryId = toStringOrNull(row.category_id);
  const monthStart = toStringOrNull(row.month_start);
  if (!id || !personId || !categoryId || !monthStart) return null;
  return {
    id,
    person_id: personId,
    category_id: categoryId,
    month_start: monthStart,
    target_amount: toNumber(row.target_amount),
    currency: toStringOrNull(row.currency) ?? "RUB",
    created_at: toStringOrNull(row.created_at) ?? "",
    updated_at: toStringOrNull(row.updated_at) ?? "",
  };
}

function normalizeBudgetCategoryNode(value: unknown): MoneyBudgetCategoryNode {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    id: toStringOrNull(row.id) ?? "",
    parent_id: toStringOrNull(row.parent_id),
    canonical_category_id: toStringOrNull(row.canonical_category_id),
    depth: toNumber(row.depth),
    name_en: toStringOrNull(row.name_en) ?? "",
    name_ru: toStringOrNull(row.name_ru) ?? "",
    slug: toStringOrNull(row.slug),
    archived_at: toStringOrNull(row.archived_at),
    is_uncategorized: Boolean(row.is_uncategorized),
    actual_income: toNumber(row.actual_income),
    actual_expenses: toNumber(row.actual_expenses),
    actual_net: toNumber(row.actual_net),
    target_amount: toNumber(row.target_amount),
    variance_amount: toNumber(row.variance_amount),
    target: normalizeBudgetTarget(row.target),
    children: Array.isArray(row.children)
      ? row.children.map((child) => normalizeBudgetCategoryNode(child))
      : [],
  };
}

function buildBudgetCategoryTree(
  values: unknown,
  monthStart: string,
  reportCurrency: string,
): MoneyBudgetCategoryNode[] {
  if (!Array.isArray(values)) return [];

  const index = new Map<
    string,
    {
      node: MoneyBudgetCategoryNode;
      parentId: string | null;
      order: number;
    }
  >();

  values.forEach((value, order) => {
    if (!value || typeof value !== "object") return;
    const row = value as RpcCategoryRow;
    const id = toStringOrNull(row.id);
    if (!id) return;

    const directTargetAmount = toNumber(row.direct_target_amount);
    index.set(id, {
      parentId: toStringOrNull(row.parent_id),
      order,
      node: {
        id,
        parent_id: toStringOrNull(row.parent_id),
        canonical_category_id: toStringOrNull(row.canonical_category_id),
        depth: toNumber(row.depth),
        name_en: toStringOrNull(row.name_en) ?? "",
        name_ru: toStringOrNull(row.name_ru) ?? "",
        slug: toStringOrNull(row.slug),
        archived_at: toStringOrNull(row.archived_at),
        is_uncategorized: toStringOrNull(row.system_key) === "uncategorized",
        actual_income: toNumber(row.actual_income),
        actual_expenses: toNumber(row.actual_expense ?? row.actual_expenses),
        actual_net: toNumber(row.actual_net),
        target_amount: toNumber(row.target_amount),
        variance_amount: toNumber(row.variance_amount),
        target:
          directTargetAmount !== 0
            ? {
                id: `money-budget-target:${id}:${monthStart}`,
                person_id: "",
                category_id: id,
                month_start: monthStart,
                target_amount: directTargetAmount,
                currency: reportCurrency,
                created_at: "",
                updated_at: "",
              }
            : null,
        children: [],
      },
    });
  });

  const roots: Array<{ node: MoneyBudgetCategoryNode; order: number }> = [];
  const sortedEntries = Array.from(index.values()).sort((left, right) => left.order - right.order);

  sortedEntries.forEach((entry) => {
    if (!entry.parentId || !index.has(entry.parentId)) {
      roots.push({ node: entry.node, order: entry.order });
      return;
    }
    index.get(entry.parentId)!.node.children.push(entry.node);
  });

  return roots.sort((left, right) => left.order - right.order).map((entry) => entry.node);
}

function normalizeBudgetTrendPoint(value: unknown): MoneyBudgetTrendPoint {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    date: toStringOrNull(row.date) ?? "",
    income: toNumber(row.income ?? row.actual_income),
    expenses: toNumber(row.expenses ?? row.actual_expense),
    net: toNumber(row.net ?? row.actual_net),
  };
}

function normalizeBudgetFxStatus(value: unknown): MoneyBudgetFxStatus {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawStatus = toStringOrNull(row.status ?? row.mode) ?? "ok";
  const missingConversions = Array.isArray(row.missing_conversions)
    ? row.missing_conversions
    : Array.isArray(row.missing_pairs)
      ? row.missing_pairs
      : [];
  const approximatedConversions = Array.isArray(row.approximated_conversions)
    ? row.approximated_conversions
    : Array.isArray(row.approximated_dates)
      ? row.approximated_dates
      : [];

  return {
    mode:
      rawStatus === "approximated"
        ? "approximate"
        : rawStatus === "error"
          ? "missing"
          : rawStatus === "missing"
            ? "missing"
            : rawStatus === "approximate"
              ? "approximate"
              : "ok",
    approximated_dates: approximatedConversions
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return null;
        return toStringOrNull((entry as Record<string, unknown>).conversion_date);
      })
      .filter((entry): entry is string => Boolean(entry)),
    missing_pairs: missingConversions
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const sourceCurrency = toStringOrNull(record.source_currency);
        const conversionDate = toStringOrNull(record.conversion_date);
        return sourceCurrency && conversionDate
          ? `${sourceCurrency}:${conversionDate}`
          : sourceCurrency;
      })
      .filter((entry): entry is string => Boolean(entry)),
    message: toStringOrNull(row.message),
    is_blocking: rawStatus === "error" || rawStatus === "missing" || Boolean(row.is_blocking),
  };
}

export function normalizeBudgetReport(row: RpcRow | null | undefined): MoneyBudgetReport {
  const safeRow = row ?? {};
  const monthStart = toStringOrNull(safeRow.month_start ?? safeRow.report_month_start) ?? "";
  const currency = toStringOrNull(safeRow.report_currency ?? safeRow.currency) ?? "RUB";
  const categories = Array.isArray(safeRow.categories)
    ? safeRow.categories.map((node) => normalizeBudgetCategoryNode(node))
    : buildBudgetCategoryTree(safeRow.category_rows, monthStart, currency);

  return {
    month_start: monthStart,
    currency,
    summary: {
      actual_income: toNumber(safeRow.actual_income),
      actual_expenses: toNumber(safeRow.actual_expense ?? safeRow.actual_expenses),
      actual_net: toNumber(safeRow.actual_net),
      target_income: toNumber(safeRow.target_income),
      target_expenses: toNumber(safeRow.target_expense ?? safeRow.target_expenses),
      target_net: toNumber(safeRow.target_net),
      variance_net: toNumber(safeRow.net_variance ?? safeRow.variance_net),
    },
    categories,
    trend: Array.isArray(safeRow.trend)
      ? safeRow.trend.map((point) => normalizeBudgetTrendPoint(point))
      : Array.isArray(safeRow.trend_points)
        ? safeRow.trend_points.map((point) => normalizeBudgetTrendPoint(point))
        : [],
    fx_status: normalizeBudgetFxStatus(safeRow.fx_status),
  };
}

/** "2026-10": the month a report is for, in UTC as the web reads it. */
export function currentReportMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftReportMonth(value: string, delta: number): string {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function reportMonthLabel(value: string, locale: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** A category's target as its editor opens on it: which way, and how much. */
export interface TargetDraft {
  direction: "income" | "expense";
  amount: string;
}

export function targetDraftOf(node: MoneyBudgetCategoryNode): TargetDraft {
  const amount = node.target?.target_amount ?? node.target_amount;
  return {
    direction: amount < 0 ? "expense" : "income",
    amount: amount === 0 ? "" : String(Math.abs(amount)),
  };
}

/** The signed target to save, or null when the amount is not a number above zero. */
export function signedTarget({ direction, amount }: TargetDraft): number | null {
  const value = Number(amount.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return direction === "expense" ? -value : value;
}

export function actualForMode(node: MoneyBudgetCategoryNode, mode: MoneyBudgetChartMode): number {
  if (mode === "income") return node.actual_income;
  if (mode === "expenses") return Math.abs(node.actual_expenses);
  return Math.abs(node.actual_net);
}

export function targetForMode(node: MoneyBudgetCategoryNode, mode: MoneyBudgetChartMode): number {
  if (mode === "income") return node.target_amount > 0 ? node.target_amount : 0;
  if (mode === "expenses") return node.target_amount < 0 ? Math.abs(node.target_amount) : 0;
  return Math.abs(node.target_amount);
}
