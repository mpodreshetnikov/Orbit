/**
 * One formula for the identity of an imported money transaction, shared by the web app's
 * statement parser and by the browser extension's bank connectors.
 *
 * Two things depend on it being literally one formula:
 *
 * - Re-importing the same statement must not create a second copy of every row. That only
 *   holds if the same operation hashes to the same value every time, which means every
 *   field has to be normalised the same way on both sides — and in SQL, where a migration
 *   recomputes the hash for rows already in the registry.
 * - A collision silently overwrites somebody else's transaction: the import path resolves a
 *   unique-constraint violation by updating the row it found and reporting `skipped`. The
 *   previous extension formula was a 32-bit FNV-1a, about four billion values, which by the
 *   birthday bound is more likely than not to collide somewhere past ~77k rows. SHA-256
 *   removes that risk rather than making it smaller.
 *
 * The extension cannot import this file — its runtime is emitted by plain `tsc` and loaded
 * by Chrome as ES modules, so it carries a copy in
 * `browserExtension/src/connectors/money-dedupe.ts`, pinned to this one by
 * `money-dedupe.parity.test.ts`. Edit here, edit there.
 *
 * What this does NOT do is make a statement row and the same operation seen by the
 * extension hash alike — the merchant text differs between the two sources. Matching across
 * sources is adoption's job (see `findAdoptableTransactionId`); this formula is about
 * stability within one source.
 */

const DELIMITER = "|";

export interface MoneyDedupeInput {
  source: string;
  postedAtIso: string;
  amount: number;
  currency: string;
  merchantName: string | null;
  accountHint: string | null;
  /**
   * Position among rows that agree on every other field. Two identical purchases on the
   * same day at the same merchant for the same amount are rare but real; without this the
   * second one hashes to the first and disappears as a duplicate.
   */
  occurrence: number;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Milliseconds-precision UTC ISO-8601, the one form both sides and SQL can produce. */
function normalizeInstant(postedAtIso: string): string {
  const parsed = new Date(postedAtIso);
  if (Number.isNaN(parsed.getTime())) return postedAtIso.trim();
  return parsed.toISOString();
}

function normalizeAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "0.00";
  // `-0` formats as `0.00`, matching what round() gives in SQL.
  return (amount + 0).toFixed(2);
}

export function buildMoneyDedupePayload(input: MoneyDedupeInput): string {
  return [
    normalizeText(input.source),
    normalizeInstant(input.postedAtIso),
    normalizeAmount(input.amount),
    normalizeText(input.currency).toUpperCase(),
    normalizeText(input.merchantName),
    normalizeText(input.accountHint),
    String(Math.max(0, Math.trunc(input.occurrence))),
  ].join(DELIMITER);
}

export async function buildMoneyDedupeHash(input: MoneyDedupeInput): Promise<string> {
  const payload = buildMoneyDedupePayload(input);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Assigns each row its `occurrence` by grouping on everything else in the formula, in the
 * order the rows arrive. Bank exports are stably ordered, so re-importing the same period
 * assigns the same numbers.
 */
export function assignMoneyDedupeOccurrences<T>(
  rows: T[],
  read: (row: T) => Omit<MoneyDedupeInput, "occurrence">,
): MoneyDedupeInput[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const fields = read(row);
    const groupKey = buildMoneyDedupePayload({ ...fields, occurrence: 0 });
    const occurrence = seen.get(groupKey) ?? 0;
    seen.set(groupKey, occurrence + 1);
    return { ...fields, occurrence };
  });
}
