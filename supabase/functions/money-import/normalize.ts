import { corsHeaders } from "../_shared/cors.ts";
import type { CanonicalTransactionRowInput, ImportLineItemInput } from "./types.ts";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function normalizeSourceForTransactions(source: string): string {
  if (source === "tbank_web") return "tbank";
  return source;
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function normalizeCurrencyCode(value: unknown): string | null {
  const text = normalizeText(value)?.toUpperCase() ?? null;
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    if (text === "643") return "RUB";
    if (text === "840") return "USD";
    if (text === "978") return "EUR";
  }
  const matched = text.match(/[A-Z]{3}/);
  return matched ? matched[0] : null;
}

function extractRawOperation(row: CanonicalTransactionRowInput): Record<string, unknown> | null {
  const rawPayload = toObject(row.raw_payload);
  return toObject(rawPayload?.operation);
}

function extractSourceCommentFallback(row: CanonicalTransactionRowInput): string | null {
  return (
    normalizeText(row.source_comment) ??
    normalizeText(row.comment) ??
    normalizeText(extractRawOperation(row)?.message) ??
    normalizeText(extractRawOperation(row)?.comment)
  );
}

function extractCashbackAmountFallback(row: CanonicalTransactionRowInput): number | null {
  const explicit = toNumberOrNull(row.cashback_amount);
  if (explicit !== null) return explicit;

  const operation = extractRawOperation(row);
  if (!operation) return null;

  const fromSummary = toNumberOrNull(toObject(operation.loyaltyBonusSummary)?.amount);
  if (fromSummary !== null) return fromSummary;

  const fromCashbackAmount = toNumberOrNull(toObject(operation.cashbackAmount)?.value);
  if (fromCashbackAmount !== null) return fromCashbackAmount;

  const fromCashback = toNumberOrNull(operation.cashback);
  if (fromCashback !== null) return fromCashback;

  const loyaltyBonus = Array.isArray(operation.loyaltyBonus) ? operation.loyaltyBonus : [];
  let sum = 0;
  let hasItems = false;
  for (const entry of loyaltyBonus) {
    const value = toNumberOrNull(toObject(toObject(entry)?.amount)?.value);
    if (value === null) continue;
    hasItems = true;
    sum += value;
  }
  return hasItems ? sum : null;
}

function extractCashbackCurrencyFallback(
  row: CanonicalTransactionRowInput,
  cashbackAmount: number | null,
  normalizedCurrency: string,
): string | null {
  const explicit = normalizeCurrencyCode(row.cashback_currency);
  if (explicit) return explicit;
  if (cashbackAmount === null) return null;

  const operation = extractRawOperation(row);
  if (!operation) return normalizedCurrency;

  const cashbackCurrency = toObject(toObject(operation.cashbackAmount)?.currency);
  const loyaltyCurrency = toObject(toObject(operation.loyaltyUnits)?.currency);

  return (
    normalizeCurrencyCode(cashbackCurrency?.strCode) ??
    normalizeCurrencyCode(cashbackCurrency?.name) ??
    normalizeCurrencyCode(cashbackCurrency?.code) ??
    normalizeCurrencyCode(loyaltyCurrency?.strCode) ??
    normalizeCurrencyCode(loyaltyCurrency?.name) ??
    normalizeCurrencyCode(loyaltyCurrency?.code) ??
    normalizedCurrency
  );
}

export function extractAccountHintFromRow(row: CanonicalTransactionRowInput): string | null {
  const rawPayload =
    row.raw_payload && typeof row.raw_payload === "object"
      ? (row.raw_payload as Record<string, unknown>)
      : null;
  const rawHint = normalizeText(rawPayload?.account_hint);
  if (!rawHint) return null;
  const digits = rawHint.replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-4);
}

export function normalizeLineItems(row: CanonicalTransactionRowInput): ImportLineItemInput[] {
  if (Array.isArray(row.line_items) && row.line_items.length > 0) return row.line_items;
  return [
    {
      title: row.merchant_name || "Imported",
      amount: row.amount,
      raw_payload: row.raw_payload ?? null,
    },
  ];
}

export function normalizeTransactionRow(
  row: CanonicalTransactionRowInput,
  fallbackSource: string,
): CanonicalTransactionRowInput {
  const source = normalizeText(row.source) ?? fallbackSource;
  const currency = normalizeText(row.currency) ?? "RUB";
  const status = normalizeText(row.status) ?? "posted";
  const transactionType = normalizeText(row.transaction_type) ?? "expense";
  const postedAtIso = toIsoOrNull(row.posted_at);
  if (!postedAtIso) throw new Error("Invalid posted_at");

  const amount = toNumberOrNull(row.amount);
  if (amount === null) throw new Error("Invalid amount");
  const normalizedComment = normalizeText(row.comment);
  const sourceComment = extractSourceCommentFallback(row);
  const cashbackAmount = extractCashbackAmountFallback(row);
  const cashbackCurrency = extractCashbackCurrencyFallback(row, cashbackAmount, currency);

  return {
    ...row,
    source,
    currency,
    status,
    transaction_type: transactionType,
    posted_at: postedAtIso,
    amount,
    external_id: normalizeText(row.external_id),
    merchant_name: normalizeText(row.merchant_name),
    mcc: normalizeText(row.mcc),
    comment: normalizedComment,
    source_comment: sourceComment,
    cashback_amount: cashbackAmount,
    cashback_currency: cashbackCurrency,
    transfer_group_id: normalizeText(row.transfer_group_id),
    dedupe_hash: normalizeText(row.dedupe_hash),
    card_id: normalizeText(row.card_id),
    account_id: normalizeText(row.account_id),
    line_items: normalizeLineItems(row),
  };
}

export function buildTransactionInsertPayload(
  row: CanonicalTransactionRowInput,
  payerPersonId: string,
): Record<string, unknown> {
  return {
    payer_person_id: payerPersonId,
    account_id: row.account_id,
    card_id: row.card_id ?? null,
    source: row.source ?? "manual",
    external_id: row.external_id ?? null,
    posted_at: row.posted_at,
    amount: row.amount,
    currency: row.currency ?? "RUB",
    transaction_type: row.transaction_type,
    status: row.status ?? "posted",
    merchant_name: row.merchant_name ?? null,
    mcc: row.mcc ?? null,
    comment: row.comment ?? null,
    source_comment: row.source_comment ?? null,
    cashback_amount: row.cashback_amount ?? null,
    cashback_currency: row.cashback_currency ?? null,
    is_transfer: row.is_transfer ?? false,
    transfer_group_id: row.transfer_group_id ?? null,
    raw_payload: row.raw_payload ?? null,
    dedupe_hash: row.dedupe_hash ?? null,
  };
}

export async function buildLineItemImportHash(
  txIdentity: string,
  lineItem: ImportLineItemInput,
  lineIndex: number,
): Promise<string> {
  const payload = {
    txIdentity,
    lineIndex,
    title: normalizeText(lineItem.title) ?? "Imported",
    amount: toNumberOrNull(lineItem.amount) ?? 0,
    quantity: toNumberOrNull(lineItem.quantity),
    unit: normalizeText(lineItem.unit),
    raw_payload: lineItem.raw_payload ?? null,
  };
  return await sha256Hex(JSON.stringify(payload));
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "23505";
}
