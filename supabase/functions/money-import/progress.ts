function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeProgressPercent(
  windowFrom: string | null,
  windowTo: string | null,
  parsedThrough: string | null,
): number | null {
  if (!windowFrom || !windowTo || !parsedThrough) return null;
  const fromMs = new Date(windowFrom).getTime();
  const toMs = new Date(windowTo).getTime();
  const parsedMs = new Date(parsedThrough).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || !Number.isFinite(parsedMs)) return null;
  if (toMs <= fromMs) return parsedMs <= fromMs ? 100 : 0;
  const done = toMs - parsedMs;
  const total = toMs - fromMs;
  return Math.round(clamp((done / total) * 100, 0, 100));
}
