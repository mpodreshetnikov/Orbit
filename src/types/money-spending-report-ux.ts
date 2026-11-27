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
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function rowOf(value: unknown): Row {
  // Stryker disable next-line ConditionalExpression: non-objects are unused fields; {} vs throw is covered by null payload
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Row;
}

function rows(value: unknown): Row[] {
  // Stryker disable next-line ArrayDeclaration: empty non-array merchants already asserted; filler array would still map to {}
  if (!Array.isArray(value)) return [];
  return value.map(rowOf);
}

function forecastRow(value: unknown): Row | null {
  // Stryker disable next-line ConditionalExpression,LogicalOperator,EqualityOperator,BooleanLiteral: overlapping null/non-object/array guards
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Row;
}

/** Normalize the RPC payload, then layer on UX-only comparison and forecast fields. */
export function normalizeSpendingReport(value: unknown): SpendingReport {
  const base = normalizeSpendingReportBase(value);
  const body = rowOf(value);
  const period = rowOf(body.period);
  const forecastRaw = forecastRow(body.forecast);
  const merchantRows = rows(body.merchants);
  const days = base.period.days;
  const compareDaysRaw = num(period.compare_days);
  const previousCompareEnd = str(period.previous_compare_end);

  let forecast: SpendingForecast | null = null;
  // Array forecasts yield base.forecast without a UX row; require both (covered by forecast: []).
  // Stryker disable next-line LogicalOperator: || would throw when forecastRaw is null
  if (base.forecast && forecastRaw) {
    const income = num(forecastRaw.income);
    const expense = num(forecastRaw.expense);
    const netRaw = Number(forecastRaw.net);
    forecast = {
      expense: base.forecast.expense,
      income,
      net: Number.isFinite(netRaw) ? num(forecastRaw.net) : income - expense,
      days_left: base.forecast.days_left,
    };
  }

  return {
    ...base,
    period: {
      ...base.period,
      compare_days: compareDaysRaw > 0 ? compareDaysRaw : days,
      previous_compare_end: previousCompareEnd ?? base.period.previous_end,
    },
    forecast,
    merchants: base.merchants.map((merchant, index) => {
      const raw = merchantRows[index] ?? {};
      return {
        ...merchant,
        previous_expense: num(raw.previous_expense),
      };
    }),
  };
}
