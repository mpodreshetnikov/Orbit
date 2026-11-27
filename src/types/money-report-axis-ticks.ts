/**
 * Nice Y-axis ticks for the money spending report chart (T-261028-yhm).
 *
 * Kept out of the shared spending-report module so incremental mutation stays small.
 */

/** Round chart axis ticks: nice steps (1/2/5 × 10ⁿ) covering `max` with about `target` ticks. */
export function niceAxisTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const safeTarget = Math.max(1, target);
  const raw = max / safeTarget;
  const power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;
  let step: number;
  if (normalized <= 1) step = power;
  else if (normalized <= 2) step = 2 * power;
  else if (normalized <= 5) step = 5 * power;
  else step = 10 * power;
  const top = Math.ceil(max / step) * step;
  const tickCount = Math.round(top / step);
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i += 1) {
    ticks.push(Math.round(i * step * 1e6) / 1e6);
  }
  return ticks;
}
