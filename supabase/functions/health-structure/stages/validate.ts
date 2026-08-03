/**
 * Value-level validation for model output.
 *
 * The database enforces these as CHECK constraints and a `date` column type, and inserts happen
 * as a single array — so one out-of-vocabulary value used to reject every row in the document,
 * losing forty good lab values because the model wrote "borderline" instead of "high".
 *
 * Validation happens here instead, per value, before anything reaches the database. Two policies:
 *
 * - An out-of-vocabulary *enumeration* falls back to the column's own default and is recorded.
 *   The entity is still good; only one attribute of it is unusable, and dropping the whole row
 *   over a severity label would lose real clinical content.
 * - An unparseable *date* becomes null and is recorded. A wrong date is worse than no date,
 *   because it silently misplaces the entity in the patient's timeline.
 */

export const OBSERVATION_STATUSES = [
  "normal",
  "low",
  "high",
  "critical_low",
  "critical_high",
  "unknown",
] as const;
export const SEVERITIES = ["mild", "moderate", "severe", "unknown"] as const;
export const LATERALITIES = ["left", "right", "bilateral", "none"] as const;
export const CONDITION_STATUSES = ["active", "resolved", "suspected", "history"] as const;

export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Laterality = (typeof LATERALITIES)[number];
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

export interface ValueIssue {
  field: string;
  received: string;
  appliedFallback: string;
}

/**
 * Coerce to a member of `allowed`, falling back when the value is absent or unrecognised.
 * Records an issue only when something unrecognised was actually supplied — an absent optional
 * value is not a defect.
 */
export function coerceEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  issues: ValueIssue[],
): T {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;

  const match = allowed.find((candidate) => candidate === normalized);
  if (match) return match;

  issues.push({ field, received: value.trim().slice(0, 40), appliedFallback: fallback });
  return fallback;
}

/**
 * Same as `coerceEnum` but for genuinely optional columns, where null is a legal stored value
 * and therefore the right fallback.
 */
export function coerceNullableEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  issues: ValueIssue[],
): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const match = allowed.find((candidate) => candidate === normalized);
  if (match) return match;

  issues.push({ field, received: value.trim().slice(0, 40), appliedFallback: "null" });
  return null;
}

/**
 * Accept only a real ISO-8601 calendar date.
 *
 * The pattern alone is not enough: "2026-02-31" matches it and is not a date. Round-tripping
 * through Date catches those, and rejects the free-text answers ("March 2026", "не указано")
 * that would otherwise reach a `date` column and fail the whole insert.
 */
export function coerceIsoDate(value: unknown, field: string, issues: ValueIssue[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    issues.push({ field, received: trimmed.slice(0, 40), appliedFallback: "null" });
    return null;
  }

  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(trimmed)) {
    issues.push({ field, received: trimmed.slice(0, 40), appliedFallback: "null" });
    return null;
  }

  return trimmed;
}

/** Clamp a confidence into [0,1]; anything unusable becomes 0. */
export function coerceConfidence(value: unknown): number {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}
