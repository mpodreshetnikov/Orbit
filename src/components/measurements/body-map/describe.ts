import type { MeasurementTrend } from "@/lib/measurement-trend";

export interface DescribeMeasurementInput {
  name: string;
  value: number | null;
  unit: string;
  trend: MeasurementTrend | null;
  /** next-intl's `t`, passed in so this stays a plain function. */
  t: (key: string) => string;
}

const TREND_KEY: Record<MeasurementTrend, string> = {
  up: "measurements.a11y.rising",
  down: "measurements.a11y.falling",
  flat: "measurements.a11y.unchanged",
};

function formatValue(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

/**
 * The accessible name for a measurement control.
 *
 * Chips and body regions carry an explicit `aria-label`, which replaces their
 * visible text as the accessible name — so without this the value, unit and
 * trend arrow (all `aria-hidden` decoration) are simply unavailable to a
 * screen reader, and an empty chip gives no hint that activating it records a
 * measurement. Yields "Left bicep, 38.5 cm, rising" or
 * "Left bicep, no value yet, add a measurement".
 */
export function describeMeasurement({
  name,
  value,
  unit,
  trend,
  t,
}: DescribeMeasurementInput): string {
  const parts: string[] = [name];

  if (value === null) {
    parts.push(t("measurements.a11y.noValueAdd"));
    return parts.join(", ");
  }

  parts.push(unit ? `${formatValue(value)} ${unit}` : formatValue(value));

  if (trend) {
    parts.push(t(TREND_KEY[trend]));
  }

  return parts.join(", ");
}
