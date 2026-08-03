/**
 * Field coercion shared by the stages.
 *
 * These helpers only normalise shape — trimming, type coercion, null handling. Validating that
 * a value is a *legal* one (an allowed enum member, a real calendar date) is a separate concern
 * handled by the schema sent to the model and, server-side, by the validation layer.
 */

export const ALLOWED_RECORD_TYPES = new Set([
  "lab",
  "visit",
  "imaging",
  "prescription",
  "vaccination",
  "vet",
  "procedure",
  "other",
]);

export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

export function asString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeRecordType(value: unknown): string {
  const raw = asString(value, "other").toLowerCase();
  return ALLOWED_RECORD_TYPES.has(raw) ? raw : "other";
}

/**
 * Reduce text to a canonical sequence of alphanumeric tokens, for verifying that a model-quoted
 * source anchor really occurs in the document.
 *
 * Whitespace normalisation alone is too strict here. A model asked to quote verbatim reliably
 * "tidies" punctuation on the way out — a hyphen becomes an en-dash, spacing around a dash
 * changes, a trailing full stop appears. Comparing raw characters throws away a *correct*
 * extraction in each of those cases, which is silent loss of a real lab value.
 *
 * So both sides are reduced to their words and numbers, and everything else becomes a separator.
 * That keeps the check strong where it matters — the words and the digits must genuinely be
 * present, in order — while ignoring the punctuation the model is prone to reformat.
 *
 * Note that separators are not collapsed away entirely: "9.7" becomes "9 7" and stays distinct
 * from "97", so decimal values cannot be confused with their digit strings.
 */
export function normalizeForGrounding(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * True when `anchor` occurs in `haystack` once both are reduced to their tokens.
 *
 * Matching is anchored to token boundaries, so a quote of "гемоглобин 97" does not match a
 * document reading "гемоглобин 970". An anchor with no tokens at all (empty, or pure
 * punctuation) is never grounded — otherwise it would match every document.
 */
export function isTextGrounded(anchor: string, haystackNormalized: string): boolean {
  const needle = normalizeForGrounding(anchor);
  if (!needle) return false;
  return ` ${haystackNormalized} `.includes(` ${needle} `);
}
