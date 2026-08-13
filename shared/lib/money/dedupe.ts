/**
 * One canonical dedupe hash for money import rows, shared by the web app and the browser extension.
 *
 * Before this module the two sides hashed differently — SHA-256 over one field set in the app, a
 * 32-bit FNV-1a over another in the extension. Eight hex digits is about four billion values, so by
 * the birthday bound a collision becomes more likely than not somewhere around 77 000 rows, and a
 * collision does not fail loudly: `insertOrResolveTransaction` treats it as a duplicate and
 * overwrites an unrelated transaction while reporting a harmless `skipped`.
 *
 * What this does NOT do is make a statement row and an API row hash alike: the statement carries the
 * bank's description text and the API its own merchant name, so the inputs differ no matter how they
 * are hashed. Matching across sources is adoption by natural key, in the import repository. This
 * formula exists for stability *within* one source.
 *
 * Every field is canonicalised so the same payload can be rebuilt in SQL character for character —
 * which the migration that recomputes stored hashes relies on. Keep this in step with
 * `public.money_build_dedupe_payload`.
 */

const FIELD_DELIMITER = "|";

export interface MoneyDedupeInput {
  source: string;
  postedAtIso: string;
  amount: number;
  currency: string;
  merchantName: string | null;
  accountHint: string | null;
  /**
   * Which repetition this row is within a group that agrees on every other field. Two identical
   * purchases on the same day at the same merchant for the same amount are rare but real, and
   * without this they hash alike and the second one silently disappears as a duplicate.
   */
  occurrence: number;
}

/** The exact instant, always rendered in UTC, so a local-offset input and a UTC input agree. */
function canonicalPostedAt(postedAtIso: string): string {
  const parsed = new Date(postedAtIso);
  if (Number.isNaN(parsed.getTime())) return postedAtIso.trim();
  return parsed.toISOString();
}

/** Two decimals, so 120.5 and 120.50 are one value and SQL `to_char` can reproduce it. */
function canonicalAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "0.00";
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  // Object.is guards the -0 case, which would otherwise render as "-0.00".
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
}

function canonicalText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function buildMoneyDedupePayload(input: MoneyDedupeInput): string {
  return [
    canonicalText(input.source),
    canonicalPostedAt(input.postedAtIso),
    canonicalAmount(input.amount),
    canonicalText(input.currency).toUpperCase(),
    canonicalText(input.merchantName),
    canonicalText(input.accountHint),
    String(Math.max(0, Math.trunc(input.occurrence))),
  ].join(FIELD_DELIMITER);
}

export async function buildMoneyDedupeHash(input: MoneyDedupeInput): Promise<string> {
  return await sha256Hex(buildMoneyDedupePayload(input));
}

/**
 * Numbers the repetitions within each group of rows that agree on every hashed field except the
 * occurrence itself, in the order the rows arrive. A bank returns a statement in a stable order, so
 * re-importing the same period assigns the same numbers and produces the same hashes.
 */
export function assignMoneyDedupeOccurrences(
  rows: Array<Omit<MoneyDedupeInput, "occurrence">>,
): MoneyDedupeInput[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const groupKey = buildMoneyDedupePayload({ ...row, occurrence: 0 });
    const occurrence = seen.get(groupKey) ?? 0;
    seen.set(groupKey, occurrence + 1);
    return { ...row, occurrence };
  });
}

/**
 * Fills `dedupe_hash` on already-built import rows.
 *
 * Connectors build their rows synchronously, but hashing is async and the occurrence of a row is
 * only known once the whole set exists — so hashing is a pass over the finished rows rather than
 * part of building each one.
 */
export async function applyMoneyDedupeHashes(
  rows: Array<Record<string, unknown>>,
  accountHintOf: (row: Record<string, unknown>) => string | null,
): Promise<void> {
  const inputs = assignMoneyDedupeOccurrences(
    rows.map((row) => ({
      source: typeof row.source === "string" ? row.source : "",
      postedAtIso: typeof row.posted_at === "string" ? row.posted_at : "",
      amount: typeof row.amount === "number" ? row.amount : 0,
      currency: typeof row.currency === "string" ? row.currency : "",
      merchantName: typeof row.merchant_name === "string" ? row.merchant_name : null,
      accountHint: accountHintOf(row),
    })),
  );

  for (let index = 0; index < rows.length; index++) {
    rows[index].dedupe_hash = await buildMoneyDedupeHash(inputs[index]);
  }
}

async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
