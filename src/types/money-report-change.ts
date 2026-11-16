/**
 * Report comparison display helpers for the money spending UX (T-261028-yhm).
 *
 * Kept out of {@link ./money-spending-report} so incremental mutation only covers this
 * small surface instead of whole-file-mutating squarify and other pre-existing helpers.
 */

/** Bases at or below one report-currency unit (or non-finite) are no comparison. */
export const COMPARISON_BASE_EPSILON = 1;

/** When |value| / |base| exceeds this, show ×N instead of a multi-thousand percent. */
export const COMPARISON_MAX_RATIO = 10;

/** The change from `base` to `value` in whole percent, or null when percent is not meaningful. */
export function percentChange(value: number, base: number): number | null {
  if (!Number.isFinite(base)) return null;
  if (Math.abs(base) <= COMPARISON_BASE_EPSILON) return null;
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) / Math.abs(base) > COMPARISON_MAX_RATIO) return null;
  return Math.round(((value - base) / Math.abs(base)) * 100);
}

function tryFormatMultiple(value: number, base: number | undefined): string | null {
  if (base === undefined) return null;
  if (!Number.isFinite(value)) return null;
  if (!Number.isFinite(base)) return null;
  if (Math.abs(base) <= COMPARISON_BASE_EPSILON) return null;
  if (Math.abs(value) / Math.abs(base) <= COMPARISON_MAX_RATIO) return null;
  const ratio = Math.abs(value) / Math.abs(base);
  return `×${Math.max(1, Math.round(ratio))}`;
}

/**
 * "▲ 8%", "▼ 3%", "0%"; when percent is not meaningful: "×N" if |value|/|base| > 10×, else
 * "новое" when the current amount is positive, otherwise null so the UI can show "—".
 */
export function formatChange(
  change: number | null,
  options?: { value?: number; base?: number; newLabel?: string },
): string | null {
  if (change === null) {
    if (!options) return null;
    const { value, base, newLabel } = options;
    // Stryker disable next-line ConditionalExpression: undefined value falls through to null either way
    if (value === undefined) return null;
    const multiple = tryFormatMultiple(value, base);
    if (multiple !== null) return multiple;
    if (value > COMPARISON_BASE_EPSILON * 0.005) {
      return newLabel ?? "новое";
    }
    return null;
  }
  if (change === 0) return "0%";
  // Stryker disable next-line EqualityOperator: change === 0 already returned; > and >= are equivalent here
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}%`;
}
