import { corsHeaders } from "../_shared/cors.ts";
import type {
  CanonicalTransactionRowInput,
  ImportLineItemInput,
  ReceiptEnrichmentStatus,
  SourceBrandInput,
  SourceCategoryInput,
} from "./types.ts";

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
  if (source === "alfa_web") return "alfa";
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

function normalizeUrl(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeColor(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const compact = text.replace(/^#/, "");
  return /^[0-9a-fA-F]{3,8}$/.test(compact) ? compact : null;
}

function isBankNativeBrandLabel(value: unknown): boolean {
  const text = normalizeText(value)?.toLowerCase();
  if (!text) return false;

  return /внутрибанковский перевод|внутрибанк(?:овский)? перевод|перевод 3-м лицам|перевод третьим лицам|между своими счетами|пополнение по номеру телефона|закрытие вклада|пополнение вклада|проценты на остаток|кэшбэк за обычные покупки|cashback payout|balance interest/.test(
    text,
  );
}

function normalizeReceiptEnrichmentStatus(value: unknown): ReceiptEnrichmentStatus | null {
  const text = normalizeText(value);
  if (
    text === "ok" ||
    text === "rate_limited" ||
    text === "skipped_after_budget" ||
    text === "not_requested" ||
    text === "error"
  ) {
    return text;
  }
  return null;
}

function extractRawOperation(row: CanonicalTransactionRowInput): Record<string, unknown> | null {
  const rawPayload = toObject(row.raw_payload);
  return toObject(rawPayload?.operation);
}

function extractMaskedCardLast4(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 4) return null;

  if (/[\*\u2022xX]/.test(text)) return digits.slice(-4);
  if (digits.length === 4) return digits;
  if (digits.length >= 12 && digits.length <= 19) return digits.slice(-4);
  return null;
}

function normalizeOperationText(value: unknown): string | null {
  const text = normalizeText(value);
  return text ? text.toLowerCase() : null;
}

function collectOperationHintCandidates(operation: Record<string, unknown> | null): string[] {
  if (!operation) return [];
  return Array.from(
    new Set(
      [
        extractMaskedCardLast4(operation.cardNumber),
        extractMaskedCardLast4(toObject(operation.payment)?.cardNumber),
        extractMaskedCardLast4(toObject(operation.card)?.panMasked),
        extractMaskedCardLast4(toObject(operation.card)?.number),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function isAccountNativeOperation(row: CanonicalTransactionRowInput): boolean {
  if (row.is_transfer) return true;

  const operation = extractRawOperation(row);
  if (!operation) return false;

  const markers = [
    normalizeOperationText(row.merchant_name),
    normalizeOperationText(operation.description),
    normalizeOperationText(operation.merchantKey),
    normalizeOperationText(operation.subcategory),
    normalizeOperationText(operation.group),
    normalizeOperationText(toObject(operation.subgroup)?.name),
    normalizeOperationText(toObject(operation.spendingCategory)?.name),
    normalizeOperationText(toObject(toObject(operation.categoryInfo)?.bankCategory)?.name),
    normalizeOperationText(toObject(toObject(operation.categoryInfo)?.metacategory)?.name),
    normalizeOperationText(toObject(operation.category)?.name),
    normalizeOperationText(toObject(operation.payment)?.providerId),
    normalizeOperationText(toObject(operation.payment)?.providerGroupId),
    normalizeOperationText(toObject(operation.payment)?.paymentType),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (
    /between own accounts|between my accounts|card to card|p2p|transfer-inner|внутрибанковский перевод|между своими счетами|пополнение по номеру телефона|перевод|переводы/.test(
      markers,
    )
  ) {
    return true;
  }

  return /interest|balance interest|deposit|bonus|correction|cashback payout|проценты|вклад|бонус|коррекц|пополнение вклада|закрытие вклада/.test(
    markers,
  );
}

function normalizeSourceCategory(
  value: SourceCategoryInput | Record<string, unknown> | null | undefined,
): SourceCategoryInput | null {
  const category = toObject(value);
  if (!category) return null;
  const id = normalizeText(category.id);
  const name = normalizeText(category.name);
  if (!id && !name) return null;
  return { id, name };
}

function normalizeSourceBrand(
  value: SourceBrandInput | Record<string, unknown> | null | undefined,
): SourceBrandInput | null {
  const brand = toObject(value);
  if (!brand) return null;
  const name = normalizeText(brand.name);
  if (!name) return null;
  const sourceKey = normalizeText(brand.source_key);
  if (isBankNativeBrandLabel(name) || isBankNativeBrandLabel(sourceKey)) return null;
  return {
    source_key: sourceKey,
    name,
    website_url: normalizeUrl(brand.website_url),
    logo_url: normalizeUrl(brand.logo_url),
    base_color: normalizeColor(brand.base_color),
    base_text_color: normalizeColor(brand.base_text_color),
  };
}

function extractSourceCategoryFallback(
  row: CanonicalTransactionRowInput,
): SourceCategoryInput | null {
  const explicit = normalizeSourceCategory(row.source_category);
  if (explicit) return explicit;
  const bankCategory = toObject(toObject(extractRawOperation(row)?.categoryInfo)?.bankCategory);
  return normalizeSourceCategory(bankCategory);
}

function extractSourceBrandFallback(row: CanonicalTransactionRowInput): SourceBrandInput | null {
  const explicit = normalizeSourceBrand(row.source_brand);
  if (explicit) return explicit;

  const operation = extractRawOperation(row);
  const brand = toObject(operation?.brand);
  if (brand) {
    return normalizeSourceBrand({
      source_key:
        normalizeText(brand.id) ??
        normalizeText(operation?.merchantKey) ??
        normalizeText(row.merchant_name),
      name: normalizeText(brand.name),
      website_url: normalizeUrl(brand.link),
      logo_url: normalizeUrl(brand.logo) ?? normalizeUrl(brand.fileLink),
      base_color: normalizeColor(brand.baseColor),
      base_text_color: normalizeColor(brand.baseTextColor),
    });
  }
  return null;
}

function extractOperationIconUrlFallback(row: CanonicalTransactionRowInput): string | null {
  return normalizeUrl(row.operation_icon_url) ?? normalizeUrl(extractRawOperation(row)?.icon);
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
  if (isAccountNativeOperation(row)) return null;

  const directHint = extractMaskedCardLast4(row.account_hint);
  const rawPayload =
    row.raw_payload && typeof row.raw_payload === "object"
      ? (row.raw_payload as Record<string, unknown>)
      : null;
  const rawHint = extractMaskedCardLast4(rawPayload?.account_hint);
  const operation = toObject(rawPayload?.operation);
  const operationCandidates = collectOperationHintCandidates(operation);
  const uniqueHints = Array.from(
    new Set(
      [directHint, rawHint, ...operationCandidates].filter((value): value is string =>
        Boolean(value),
      ),
    ),
  );

  if (operation && uniqueHints.length > 1) return null;
  if (directHint) return directHint;
  if (rawHint) return rawHint;
  if (operationCandidates.length === 1) return operationCandidates[0];
  return null;
}

export function normalizeLineItems(row: CanonicalTransactionRowInput): ImportLineItemInput[] {
  if (Array.isArray(row.line_items) && row.line_items.length > 0) return row.line_items;
  return [
    {
      title: row.merchant_name || "Imported",
      amount: row.amount,
      raw_payload: row.raw_payload ?? null,
      is_placeholder: true,
    },
  ];
}

export function isSyntheticImportLineItem(
  lineItem: ImportLineItemInput | null | undefined,
): boolean {
  // The explicit flag is authoritative for anything written after the placeholder
  // migration. The raw_payload probe stays for rows already in the registry that
  // predate the column, and for extension payloads that still carry the marker.
  if (lineItem?.is_placeholder === true) return true;
  const rawPayload = toObject(lineItem?.raw_payload);
  const source = normalizeText(rawPayload?.source)?.toLowerCase();
  return source === "fallback" || source === "dom_fallback";
}

export function hasRealImportLineItems(
  lineItems: Array<ImportLineItemInput | null | undefined>,
): boolean {
  return lineItems.some(
    (lineItem) =>
      lineItem !== null && lineItem !== undefined && !isSyntheticImportLineItem(lineItem),
  );
}

export function hasOnlySyntheticImportLineItems(
  lineItems: Array<ImportLineItemInput | null | undefined>,
): boolean {
  return lineItems.length > 0 && lineItems.every((lineItem) => isSyntheticImportLineItem(lineItem));
}

/** Money is stored to the kopeck, so sums are rounded there before comparison. */
function roundToKopecks(value: number): number {
  return Math.round(value * 100) / 100;
}

export const BALANCING_LINE_ITEM_SOURCE = "balancing";
export const BALANCING_LINE_ITEM_TITLE = "Прочее по операции";
/** Differences at or below one kopeck are rounding noise, not a real discrepancy. */
export const BALANCING_TOLERANCE = 0.01;
/**
 * A receipt that explains less than half of the operation is not this operation's
 * receipt. Balancing such a gap would silently invent a line item larger than the
 * evidence, so the row is rejected instead.
 */
export const BALANCING_MAX_SHARE = 0.5;

export function buildBalancingLineItem(
  row: CanonicalTransactionRowInput,
  lineItems: Array<ImportLineItemInput | null | undefined>,
): ImportLineItemInput | null {
  const transactionAmount = toNumberOrNull(row.amount);
  if (transactionAmount === null) return null;

  const lineItemsSum = lineItems.reduce((total, lineItem) => {
    if (!lineItem) return total;
    return total + (toNumberOrNull(lineItem.amount) ?? 0);
  }, 0);

  const delta = roundToKopecks(transactionAmount - lineItemsSum);
  if (Math.abs(delta) < BALANCING_TOLERANCE) return null;

  if (Math.abs(delta) > Math.abs(transactionAmount) * BALANCING_MAX_SHARE) {
    throw new Error("Receipt total does not match transaction amount");
  }

  return {
    title: BALANCING_LINE_ITEM_TITLE,
    amount: delta,
    raw_payload: { source: BALANCING_LINE_ITEM_SOURCE, delta },
  };
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
  const sourceCategory = extractSourceCategoryFallback(row);
  const sourceBrand = extractSourceBrandFallback(row);
  const operationIconUrl = extractOperationIconUrlFallback(row);

  return {
    ...row,
    source,
    account_hint: extractAccountHintFromRow(row),
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
    operation_icon_url: operationIconUrl,
    source_category: sourceCategory,
    source_brand: sourceBrand,
    source_category_id: sourceCategory?.id ?? null,
    source_category_name: sourceCategory?.name ?? null,
    brand_id: normalizeText(row.brand_id),
    receipt_request_key: normalizeText(row.receipt_request_key),
    receipt_enrichment_status: normalizeReceiptEnrichmentStatus(row.receipt_enrichment_status),
    receipt_line_items_skipped: row.receipt_line_items_skipped === true,
    receipt_retryable: row.receipt_retryable === true,
    receipt_retry_attempts: Math.max(0, toNumberOrNull(row.receipt_retry_attempts) ?? 0),
    receipt_result_code: normalizeText(row.receipt_result_code),
    receipt_tracking_id: normalizeText(row.receipt_tracking_id),
    receipt_message: normalizeText(row.receipt_message),
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
    operation_icon_url: row.operation_icon_url ?? null,
    source_category_id: row.source_category?.id ?? row.source_category_id ?? null,
    source_category_name: row.source_category?.name ?? row.source_category_name ?? null,
    brand_id: row.brand_id ?? null,
    receipt_request_key: row.receipt_request_key ?? null,
    receipt_enrichment_status: row.receipt_enrichment_status ?? null,
    is_transfer: row.is_transfer ?? false,
    transfer_group_id: row.transfer_group_id ?? null,
    raw_payload: row.raw_payload ?? null,
    dedupe_hash: row.dedupe_hash ?? null,
  };
}

export function buildReceiptPersistenceFields(
  row: CanonicalTransactionRowInput,
): Record<string, unknown> {
  return {
    receipt_request_key: row.receipt_request_key ?? null,
    receipt_enrichment_status: row.receipt_enrichment_status ?? null,
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
