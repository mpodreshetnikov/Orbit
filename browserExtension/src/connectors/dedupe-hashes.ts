import { assignMoneyDedupeOccurrences, buildMoneyDedupeHash } from "@shared/lib/money/dedupe.js";

type JsonMap = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finiteNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Fills `dedupe_hash` on every mapped row with the shared money identity formula.
 *
 * It runs over the whole run rather than per row for two reasons: the formula numbers
 * repeats within a group, which needs to see sibling rows, and SHA-256 through WebCrypto is
 * async while the row mappers are not.
 */
export async function applyMoneyDedupeHashes(
  rows: JsonMap[],
  fallbackSource: string,
): Promise<void> {
  const inputs = assignMoneyDedupeOccurrences(rows, (row) => ({
    source: text(row.source) ?? fallbackSource,
    postedAtIso: text(row.posted_at) ?? "",
    amount: finiteNumber(row.amount),
    currency: text(row.currency) ?? "RUB",
    merchantName: text(row.merchant_name),
    accountHint: text(row.account_hint),
  }));

  for (let index = 0; index < rows.length; index++) {
    rows[index].dedupe_hash = await buildMoneyDedupeHash(inputs[index]);
  }
}
