/**
 * Pure text-side category-rule filter operators for Vitest / fast-check pilots.
 *
 * The production twins live in Deno (`supabase/functions/money-categorize/service.ts`)
 * and SQL (`money_evaluate_category_rule_filter`). Do not treat this module as a second
 * product implementation — it is the shared-shape oracle for property tests and the
 * SQL↔TS parity recipe in `docs/design/common/sql-ts-parity.md`. When behaviour changes,
 * update the Deno/SQL twins (owned by mutation/gap work) and keep these helpers in lockstep.
 */

export type TextFilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "starts_with"
  | "contains_any_in_set"
  | "equals_any_in_set"
  | "is_empty"
  | "is_not_empty";

export function normalizeComparableText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

export function matchTextFilter(
  operator: TextFilterOperator,
  rawValue: unknown,
  filterValue: unknown,
  filterValues?: readonly string[],
): boolean {
  const textValue = normalizeComparableText(rawValue);
  const needle = normalizeComparableText(filterValue);
  // Stryker disable next-line ArrayDeclaration: seed values are not normalized, so they cannot match lowercased textValue/includes checks
  const setValues: string[] = [];
  for (const raw of filterValues ?? []) {
    const normalized = normalizeComparableText(raw);
    if (normalized != null) setValues.push(normalized);
  }

  switch (operator) {
    case "contains":
      return Boolean(textValue && needle && textValue.includes(needle));
    case "not_contains":
      return !textValue || !needle || !textValue.includes(needle);
    case "equals":
      // `===` alone is not enough: null === null is true, but empty/nullish is not a match.
      return textValue === needle && textValue != null;
    case "starts_with":
      return Boolean(textValue && needle && textValue.startsWith(needle));
    case "contains_any_in_set":
      return Boolean(textValue && setValues.some((v) => textValue.includes(v)));
    case "equals_any_in_set":
      // No separate null guard: a null textValue must not match, and blank set
      // entries must not survive as null members (see unit tests).
      return setValues.includes(textValue as string);
    case "is_empty":
      return textValue == null;
    case "is_not_empty":
      return textValue != null;
  }
}
