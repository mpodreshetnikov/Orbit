import type { MeasurementCategory, MeasurementSummary } from "@orbit-types/measurement";
import { MEASUREMENT_CATEGORIES } from "@orbit-types/measurement";
import { getMeasurementTrend, type MeasurementTrend } from "@orbit-types/measurement-trend";
import { t } from "@/lib/i18n";

/** A value as the web app prints it: whole numbers bare, others to `digits` places. */
export function formatValue(value: number, digits = 1): string {
  return value.toFixed(value % 1 === 0 ? 0 : digits);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `dd.MM.yyyy`, the list's date. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** `dd.MM.yyyy, HH:mm`, a history entry's moment. */
export function formatMoment(iso: string): string {
  const date = new Date(iso);
  return `${formatDay(iso)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function categoryLabel(category: MeasurementCategory): string {
  return t(`measurements.categories.${category}`);
}

/** Summaries in sections by category, in the catalogue's category order, empty ones left out. */
export function byCategory<T extends Pick<MeasurementSummary, "category">>(
  items: T[],
): { category: MeasurementCategory; data: T[] }[] {
  return MEASUREMENT_CATEGORIES.map((category) => ({
    category,
    data: items.filter((item) => item.category === category),
  })).filter((section) => section.data.length > 0);
}

/** The detail page's trend card: the direction of the latest change and its size in percent. */
export function trendPercent(
  history: { value: number }[],
): { trend: MeasurementTrend; percent: number } | null {
  const trend = getMeasurementTrend(history);
  if (!trend) return null;
  const [previous, latest] = history.slice(-2).map((point) => point.value);
  return { trend, percent: Math.abs(((latest - previous) / previous) * 100) };
}
