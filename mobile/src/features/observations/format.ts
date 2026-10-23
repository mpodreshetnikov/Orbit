import type {
  ObservationHistoryPoint,
  ObservationStatus,
  ObservationSummary,
} from "@orbit-types/medical-record";
import { formatValue } from "@/features/measurements/format";
import type { Palette } from "@/theme";

/** A point's value in the catalogue's unit when it was converted, as written otherwise. */
export function pointValue(point: ObservationHistoryPoint): number | null {
  return point.value_canonical ?? point.value_numeric;
}

/** "5.4", or the text a result was given as, or a dash. */
export function shownValue(value: number | null, text: string | null, digits = 1): string {
  return value !== null ? formatValue(value, digits) : text || "—";
}

/** A bound as written, without the float tail a unit conversion leaves ("3.885", not "3.8850000000000002"). */
const bound = (value: number) => String(Number(value.toFixed(3)));

/** "3.5–5.5", or a dash when either end is missing. */
export function rangeText(low: number | null, high: number | null): string {
  return low !== null && high !== null ? `${bound(low)}–${bound(high)}` : "—";
}

/**
 * The range a summary is judged against, in the unit of its latest value: the latest result's own
 * (converted when the value was), else the catalogue's.
 */
export function summaryRange(summary: ObservationSummary): [number | null, number | null] {
  return [
    summary.latest_ref_low_canonical ?? summary.latest_ref_low ?? summary.default_ref_low,
    summary.latest_ref_high_canonical ?? summary.latest_ref_high ?? summary.default_ref_high,
  ];
}

/** The web badge's colour for a status: green for normal, blue low, orange high, red critical. */
export function statusTone(status: ObservationStatus): keyof Palette {
  if (status === "normal") return "success";
  if (status === "low") return "falling";
  if (status === "high") return "rising";
  return "destructive";
}

/** The results a chart can draw, oldest first, each with its date: a text-only result has no point. */
export function chartPoints(history: ObservationHistoryPoint[]): { value: number; date: string }[] {
  return history.flatMap((point) => {
    const value = pointValue(point);
    return value === null ? [] : [{ value, date: point.record_date || point.created_at }];
  });
}

/** The values a chart can draw, oldest first. */
export function chartValues(history: ObservationHistoryPoint[]): number[] {
  return chartPoints(history).map((point) => point.value);
}
