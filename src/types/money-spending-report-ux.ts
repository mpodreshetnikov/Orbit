/**
 * UX extensions on top of the shared spending-report types (T-261028-yhm).
 *
 * Branch-only fields and helpers live here so `money-spending-report.ts` can stay
 * identical to main and stay out of the incremental mutation set.
 */

import {
  normalizeSpendingReport as normalizeSpendingReportBase,
  type SpendingForecast as SpendingForecastBase,
  type SpendingMerchant as SpendingMerchantBase,
  type SpendingReport as SpendingReportBase,
  type SpendingReportMode,
} from "./money-spending-report";

export type SpendingMerchant = SpendingMerchantBase & {
  previous_expense: number;
};

export type SpendingForecast = SpendingForecastBase & {
  income: number;
  net: number;
};

export type SpendingReport = Omit<SpendingReportBase, "period" | "forecast" | "merchants"> & {
  period: SpendingReportBase["period"] & {
    /** Day-count used for vs-previous / vs-last-year (elapsed while the period is incomplete). */
    compare_days: number;
    previous_compare_end: string;
  };
  forecast: SpendingForecast | null;
  merchants: SpendingMerchant[];
};

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

/** Normalize the RPC payload, then layer on UX-only comparison and forecast fields. */
export function normalizeSpendingReport(value: unknown): SpendingReport {
  const base = normalizeSpendingReportBase(value);
  const body = rowOf(value);
  const period = rowOf(body.period);
  const forecastRaw =
    body.forecast && typeof body.forecast === "object" ? rowOf(body.forecast) : null;
  const merchantRows = rows(body.merchants);
  const days = base.period.days;

  return {
    ...base,
    period: {
      ...base.period,
      compare_days: num(period.compare_days) || days,
      previous_compare_end: str(period.previous_compare_end) ?? base.period.previous_end,
    },
    forecast: base.forecast
      ? {
          expense: base.forecast.expense,
          income: num(forecastRaw?.income),
          net: Number.isFinite(Number(forecastRaw?.net))
            ? num(forecastRaw?.net)
            : num(forecastRaw?.income) - num(forecastRaw?.expense),
          days_left: base.forecast.days_left,
        }
      : null,
    merchants: base.merchants.map((merchant, index) => ({
      ...merchant,
      previous_expense: num(merchantRows[index]?.previous_expense),
    })),
  };
}

/** Round chart axis ticks: nice steps (1/2/5 × 10ⁿ) covering `max` with about `target` ticks. */
export function niceAxisTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;
  const step =
    normalized <= 1
      ? power
      : normalized <= 2
        ? 2 * power
        : normalized <= 5
          ? 5 * power
          : 10 * power;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step * 0.001; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return ticks;
}

/** Ledger query for the report's period/accounts/category/merchant filters. */
export function transactionsFeedQuery(input: {
  start: string;
  end: string;
  accountIds?: string[];
  categoryId?: string | null;
  merchantName?: string | null;
  mode?: SpendingReportMode;
}): string {
  const params = new URLSearchParams();
  params.set("preset", "custom");
  params.set("from", `${input.start}T00:00:00.000Z`);
  params.set("to", `${input.end}T23:59:59.999Z`);
  if (input.accountIds && input.accountIds.length > 0) {
    params.set("accounts", input.accountIds.join(","));
  }
  if (input.categoryId) params.set("categories", input.categoryId);
  if (input.merchantName) params.set("q", input.merchantName);
  if (input.mode === "expense" || input.mode === "income") params.set("sign", input.mode);
  return params.toString();
}
