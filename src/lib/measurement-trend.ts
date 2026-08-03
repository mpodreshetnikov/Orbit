export type MeasurementTrend = "up" | "down" | "flat";

/** Percentage change smaller than this counts as no change. */
export const TREND_DEAD_ZONE_PERCENT = 1;

/**
 * Direction of the latest change in a measurement's history.
 *
 * History is expected oldest-first, matching `MeasurementSummary.history`.
 * Returns null when there is nothing to compare against — fewer than two
 * points, or a previous value of zero, which would make the ratio meaningless.
 */
export function getMeasurementTrend(history: { value: number }[]): MeasurementTrend | null {
  if (history.length < 2) {
    return null;
  }

  const latest = history[history.length - 1].value;
  const previous = history[history.length - 2].value;

  if (previous === 0) {
    return null;
  }

  // Divide by the magnitude, not the signed value: a rise from -100 to -50 is
  // still a rise. Measurements are non-negative in practice, so this changes
  // nothing for real data and only keeps the helper honest for any other caller.
  const diff = ((latest - previous) / Math.abs(previous)) * 100;

  if (Math.abs(diff) < TREND_DEAD_ZONE_PERCENT) {
    return "flat";
  }

  return diff > 0 ? "up" : "down";
}
