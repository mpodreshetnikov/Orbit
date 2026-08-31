/**
 * The money identity formula, as the extension runtime can hold it.
 *
 * `shared/lib/money/dedupe.ts` is the canonical statement of this formula and the copy the
 * web app and the SQL migration were written against. The extension cannot import it: its
 * runtime is emitted by plain `tsc` and loaded by Chrome as ES modules, so module specifiers
 * survive into `dist/` verbatim — a `@shared/...` import would either fail to compile or,
 * worse, compile and then fail to load in the service worker. Only `popup-src` goes through
 * a bundler.
 *
 * So the formula exists twice, and `money-dedupe.parity.test.ts` fails the build if the two
 * copies ever disagree on a payload, a hash or an occurrence number. Change one, change the
 * other; the test is what makes that a rule rather than a hope.
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
