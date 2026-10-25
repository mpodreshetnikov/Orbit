/**
 * Build a stable dedupe_hash for import rows.
 * Formula: hash(source | posted_at_iso | amount | currency | merchant_name | account_hint)
 */

const DELIM = "|";

export function buildDedupeHashPayload(
  source: string,
  postedAtIso: string,
  amount: number,
  currency: string,
  merchantName: string | null,
  accountHint: string | null,
): string {
  return [
    source,
    postedAtIso,
    String(amount),
    currency,
    merchantName ?? "",
    accountHint ?? "",
  ].join(DELIM);
}

/**
 * Returns a short hex hash of the payload for use as dedupe_hash.
 * Uses SHA-256 when available (browser/Node), otherwise a simple djb2-style fallback.
 */
export async function buildDedupeHash(
  source: string,
  postedAtIso: string,
  amount: number,
  currency: string,
  merchantName: string | null,
  accountHint: string | null,
): Promise<string> {
  const payload = buildDedupeHashPayload(
    source,
    postedAtIso,
    amount,
    currency,
    merchantName,
    accountHint,
  );
  if (typeof crypto !== "undefined" && "subtle" in crypto) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return simpleHash(payload);
}

function simpleHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
