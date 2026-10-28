/**
 * The money report as the web page and the phone read it from `money_get_spending_report`
 * (T-261028-yhm): a period's totals against the period before and last year's average, a spending
 * forecast, categories with twelve months of history, days and top merchants — plus the pure
 * helpers both clients share: the period a report covers, the change between two amounts, and the
 * treemap layout of the categories.
 */

export type SpendingReportMode = "expense" | "income";

export type SpendingPeriodKind = "week" | "month" | "last30" | "custom";

export interface SpendingPeriod {
  kind: SpendingPeriodKind;
  /** First day, `YYYY-MM-DD`. */
  start: string;
  /** Last day, inclusive, `YYYY-MM-DD`. */
  end: string;
}

export interface SpendingTotals {
  income: number;
  expense: number;
  net: number;
  previous_income: number;
  previous_expense: number;
  previous_net: number;
  last_year_income: number;
  last_year_expense: number;
  last_year_net: number;
}

export interface SpendingMonth {
  month_start: string;
  income: number;
  expense: number;
}

export interface SpendingCategory {
  id: string;
  parent_id: string | null;
  system_key: string | null;
  name_en: string;
  name_ru: string;
  has_children: boolean;
  income: number;
  expense: number;
  previous_income: number;
  previous_expense: number;
  last_year_income: number;
  last_year_expense: number;
  months: SpendingMonth[];
}

export interface SpendingDay {
  date: string;
  income: number;
  expense: number;
}

export interface SpendingMerchant {
  brand_id: string | null;
  name: string;
  logo_url: string | null;
  base_color: string | null;
  expense: number;
  transaction_count: number;
}

export interface SpendingForecast {
  expense: number;
  days_left: number;
}

export interface SpendingReport {
  period: {
    start: string;
    end: string;
    days: number;
    previous_start: string;
    previous_end: string;
    last_year: number;
  };
  currency: string;
  totals: SpendingTotals;
  forecast: SpendingForecast | null;
  categories: SpendingCategory[];
  days: SpendingDay[];
  merchants: SpendingMerchant[];
  fx_status: { status: "ok" | "approximated" | "error"; missing: string[] };
}

type Row = Record<string, unknown>;

function num(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function rowOf(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(rowOf) : [];
}

export function normalizeSpendingReport(value: unknown): SpendingReport {
  const body = rowOf(value);
  const period = rowOf(body.period);
  const totals = rowOf(body.totals);
  const forecast = body.forecast && typeof body.forecast === "object" ? rowOf(body.forecast) : null;
  const fx = rowOf(body.fx_status);
  const fxStatus = str(fx.status);

  return {
    period: {
      start: str(period.start) ?? "",
      end: str(period.end) ?? "",
      days: num(period.days),
      previous_start: str(period.previous_start) ?? "",
      previous_end: str(period.previous_end) ?? "",
      last_year: num(period.last_year),
    },
    currency: str(body.currency) ?? "RUB",
    totals: {
      income: num(totals.income),
      expense: num(totals.expense),
      net: num(totals.net),
      previous_income: num(totals.previous_income),
      previous_expense: num(totals.previous_expense),
      previous_net: num(totals.previous_net),
      last_year_income: num(totals.last_year_income),
      last_year_expense: num(totals.last_year_expense),
      last_year_net: num(totals.last_year_net),
    },
    forecast: forecast
      ? { expense: num(forecast.expense), days_left: num(forecast.days_left) }
      : null,
    categories: rows(body.categories)
      .filter((row) => str(row.id))
      .map((row) => ({
        id: str(row.id)!,
        parent_id: str(row.parent_id),
        system_key: str(row.system_key),
        name_en: str(row.name_en) ?? "",
        name_ru: str(row.name_ru) ?? "",
        has_children: Boolean(row.has_children),
        income: num(row.income),
        expense: num(row.expense),
        previous_income: num(row.previous_income),
        previous_expense: num(row.previous_expense),
        last_year_income: num(row.last_year_income),
        last_year_expense: num(row.last_year_expense),
        months: rows(row.months).map((month) => ({
          month_start: str(month.month_start) ?? "",
          income: num(month.income),
          expense: num(month.expense),
        })),
      })),
    days: rows(body.days).map((day) => ({
      date: str(day.date) ?? "",
      income: num(day.income),
      expense: num(day.expense),
    })),
    merchants: rows(body.merchants).map((merchant) => ({
      brand_id: str(merchant.brand_id),
      name: str(merchant.name) ?? "",
      logo_url: str(merchant.logo_url),
      base_color: str(merchant.base_color),
      expense: num(merchant.expense),
      transaction_count: num(merchant.transaction_count),
    })),
    fx_status: {
      status: fxStatus === "error" || fxStatus === "approximated" ? fxStatus : "ok",
      missing: rows(fx.missing_conversions)
        .map((entry) => {
          const currency = str(entry.source_currency);
          const date = str(entry.conversion_date);
          return currency && date ? `${currency}:${date}` : null;
        })
        .filter((entry): entry is string => Boolean(entry)),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------------

function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseDay(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

/** The number of days from `start` to `end`, both included. */
export function periodDays(period: Pick<SpendingPeriod, "start" | "end">): number {
  return (
    Math.round((parseDay(period.end).valueOf() - parseDay(period.start).valueOf()) / 86_400_000) + 1
  );
}

/** The period of a kind that contains `today`: its week (Monday first), its month, or the 30 days ending on it. */
export function periodContaining(
  kind: Exclude<SpendingPeriodKind, "custom">,
  today: string,
): SpendingPeriod {
  const date = parseDay(today);
  if (kind === "month") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    return { kind, start: isoDay(start), end: isoDay(end) };
  }
  if (kind === "week") {
    const offset = (date.getUTCDay() + 6) % 7;
    const start = addDays(today, -offset);
    return { kind, start, end: addDays(start, 6) };
  }
  return { kind, start: addDays(today, -29), end: today };
}

/** The period one step before (`-1`) or after (`1`) this one, of the same kind and length. */
export function shiftPeriod(period: SpendingPeriod, delta: number): SpendingPeriod {
  if (period.kind === "month") {
    const start = parseDay(period.start);
    const shifted = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + delta, 1));
    return periodContaining("month", isoDay(shifted));
  }
  const days = periodDays(period) * delta;
  return { kind: period.kind, start: addDays(period.start, days), end: addDays(period.end, days) };
}

export function parsePeriod(
  kind: string | null,
  start: string | null,
  end: string | null,
  today: string,
): SpendingPeriod {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (kind === "custom" && start && end && day.test(start) && day.test(end) && start <= end) {
    return { kind, start, end };
  }
  const resolved = kind === "week" || kind === "last30" ? kind : "month";
  return periodContaining(resolved, start && day.test(start) ? start : today);
}

/** "октябрь 2026", "12–18 окт. 2026", "29 сент. – 28 окт. 2026": how the period reads in a header. */
export function periodLabel(period: SpendingPeriod, locale: string): string {
  const start = parseDay(period.start);
  const end = parseDay(period.end);
  if (period.kind === "month") {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(start);
  }
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return format.formatRange(start, end);
}

// ---------------------------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------------------------

/** The change from `base` to `value` in whole percent, or null when there is nothing to compare with. */
export function percentChange(value: number, base: number): number | null {
  if (!Number.isFinite(base) || Math.abs(base) < 0.005) return null;
  return Math.round(((value - base) / Math.abs(base)) * 100);
}

export function amountOf(
  row: Pick<SpendingCategory, "income" | "expense">,
  mode: SpendingReportMode,
): number {
  return mode === "income" ? row.income : row.expense;
}

export function previousOf(row: SpendingCategory, mode: SpendingReportMode): number {
  return mode === "income" ? row.previous_income : row.previous_expense;
}

export function lastYearOf(row: SpendingCategory, mode: SpendingReportMode): number {
  return mode === "income" ? row.last_year_income : row.last_year_expense;
}

/** The categories directly under `parentId` (the roots when null) that moved money in this mode, largest first. */
export function childCategories(
  categories: SpendingCategory[],
  parentId: string | null,
  mode: SpendingReportMode,
): SpendingCategory[] {
  return categories
    .filter((category) => category.parent_id === parentId && amountOf(category, mode) > 0)
    .sort((left, right) => amountOf(right, mode) - amountOf(left, mode));
}

/** The categories a filtered report starts from: the filter's children, or the roots without one. */
export function topCategories(
  categories: SpendingCategory[],
  filterCategoryId: string | null,
  mode: SpendingReportMode,
): SpendingCategory[] {
  if (filterCategoryId && categories.some((category) => category.parent_id === filterCategoryId)) {
    return childCategories(categories, filterCategoryId, mode);
  }
  if (filterCategoryId) {
    return categories.filter(
      (category) => category.id === filterCategoryId && amountOf(category, mode) > 0,
    );
  }
  return childCategories(categories, null, mode);
}

// ---------------------------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------------------------

export interface TreemapTile<T> {
  item: T;
  /** Position and size as fractions of the whole map, 0..1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function worstRatio(row: number[], length: number): number {
  const sum = row.reduce((total, value) => total + value, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((length * length * max) / (sum * sum), (sum * sum) / (length * length * min));
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk) of `items` by `value`, in a map `aspect` times as
 * wide as it is tall. Items with no positive value get no tile.
 */
export function squarify<T>(items: T[], value: (item: T) => number, aspect = 1): TreemapTile<T>[] {
  const entries = items
    .map((item) => ({ item, value: value(item) }))
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value);
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  if (total <= 0) return [];

  // Lay out in a space of area `aspect` (width `aspect`, height 1), then normalise to fractions.
  const scale = aspect / total;
  const tiles: TreemapTile<T>[] = [];
  let rect: Rect = { x: 0, y: 0, width: aspect, height: 1 };
  let index = 0;

  while (index < entries.length) {
    const length = Math.min(rect.width, rect.height);
    const row: typeof entries = [entries[index]!];
    index += 1;
    while (index < entries.length) {
      const current = row.map((entry) => entry.value * scale);
      const next = [...current, entries[index]!.value * scale];
      if (worstRatio(next, length) > worstRatio(current, length)) break;
      row.push(entries[index]!);
      index += 1;
    }

    const rowArea = row.reduce((sum, entry) => sum + entry.value * scale, 0);
    const horizontal = rect.width >= rect.height;
    const thickness = rowArea / length;
    let offset = 0;
    for (const entry of row) {
      const span = (entry.value * scale) / thickness;
      tiles.push({
        item: entry.item,
        x: (horizontal ? rect.x : rect.x + offset) / aspect,
        y: horizontal ? rect.y + offset : rect.y,
        width: (horizontal ? thickness : span) / aspect,
        height: horizontal ? span : thickness,
      });
      offset += span;
    }
    rect = horizontal
      ? { x: rect.x + thickness, y: rect.y, width: rect.width - thickness, height: rect.height }
      : { x: rect.x, y: rect.y + thickness, width: rect.width, height: rect.height - thickness };
  }

  return tiles;
}

/** Three shades by rank, darkest for the largest: the map's colour says size before the label does. */
export function treemapShade(rank: number, count: number): "strong" | "medium" | "light" {
  if (count <= 1 || rank < Math.max(1, Math.round(count * 0.3))) return "strong";
  if (rank < Math.max(2, Math.round(count * 0.6))) return "medium";
  return "light";
}

/** A report amount: whole units, because a report is read for its size, not its kopecks. */
export function formatReportAmount(amount: number, currency: string, locale: string): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: (currency || "RUB").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(safeAmount);
  } catch {
    return `${Math.round(safeAmount)} ${currency}`;
  }
}

/** "▲ 8%", "▼ 3%", "0%"; null without a base to compare with. */
export function formatChange(change: number | null): string | null {
  if (change === null) return null;
  if (change === 0) return "0%";
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}%`;
}

/**
 * Whether a change is good news: more income or less spending is, so the same arrow reads in
 * opposite colours for the two.
 */
export function changeTone(
  change: number | null,
  mode: SpendingReportMode | "net",
): "good" | "bad" | "neutral" {
  if (change === null || change === 0) return "neutral";
  const up = change > 0;
  return (mode === "expense" ? !up : up) ? "good" : "bad";
}
