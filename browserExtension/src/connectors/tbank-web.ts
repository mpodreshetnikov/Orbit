import { registerConnector } from "./registry.js";
import { isPathUnder } from "../core/page-url.js";
import type {
  Connector,
  ConnectorParseInput,
  ConnectorParseOutput,
  ConnectorParseStrategy,
} from "./types.js";

const OPERATIONS_PAGE_URL = "https://www.tbank.ru/mybank/operations/";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 30;
const EXTRACTION_ATTEMPTS = 2;
/** The message the in-page extractor reports its outcome with; see `runPageExtraction`. */
const PAGE_EXTRACTION_MESSAGE = "MONEY_IMPORT_PAGE_EXTRACTION";
/** How long a page may take to report when its session states no expiry. */
const DEFAULT_EXTRACTION_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const DEFAULT_RECEIPT_PARSE_STRATEGY: ConnectorParseStrategy = "fast";
const FULL_RECEIPT_BASE_PAUSE_MS = 4000;
const FULL_RECEIPT_RESPONSE_OVERHEAD_MS = 750;
const FULL_RECEIPT_WINDOW_LIMIT = 70;
const FULL_RECEIPT_WINDOW_MS = 10 * 60 * 1000;
const FULL_RECEIPT_WINDOW_BUFFER_MS = 5000;
const FULL_RECEIPT_FINALIZATION_BUFFER_MS = 30000;

type JsonMap = Record<string, unknown>;
type ReceiptEnrichmentStatus =
  | "ok"
  | "rate_limited"
  | "skipped_after_budget"
  | "not_requested"
  | "error";

interface ShoppingReceiptEnrichmentMeta {
  receipt_request_key: string | null;
  receipt_enrichment_status: ReceiptEnrichmentStatus;
  skip_reason?: string | null;
  receipt_line_items_skipped: boolean;
  receipt_retryable: boolean;
  receipt_retry_attempts: number;
  receipt_result_code: string | null;
  receipt_tracking_id: string | null;
  receipt_message: string | null;
  expected: boolean;
  requested: boolean;
}

interface PageOperationRecord {
  operation: JsonMap;
  operationDetail: JsonMap | null;
  shoppingReceipt: JsonMap | null;
  shoppingReceiptMeta: ShoppingReceiptEnrichmentMeta | null;
  trancheOffers: JsonMap | null;
}

/** What the in-page extractor answers when asked to report by message instead. */
interface PageExtractionStart {
  started: true;
  report_token: string;
}

interface PageExtraction {
  method: "api" | "dom";
  blocked_reason?: string;
  operation_records?: PageOperationRecord[];
  rows?: JsonMap[];
  window_to: string;
  parsed_through_at: string;
  parsed_transactions_count: number;
  debug?: {
    extraction_method: "api" | "dom";
    fallback_used: boolean;
    fallback_reason: string | null;
    blocked_reason: string | null;
    discovered_endpoints: {
      operations_api: string | null;
      operation_detail_api: string | null;
      tranche_offers_api: string | null;
    };
    range_attempts: Array<{
      start: number;
      end: number;
      status_code: number | null;
      payload_count: number | null;
    }>;
    range_request_count?: number;
    effective_chunk_span_days?: number | null;
    first_operation_posted_at?: string | null;
    last_operation_posted_at?: string | null;
    page_originated_operations_request_seen?: boolean;
    response_status_histogram: Record<string, number>;
    stage_timings_ms: Record<string, number>;
    api_error_message: string | null;
    api_operation_count: number;
    dom_row_count: number;
    receipt_enrichment?: {
      requested_count: number;
      success_count: number;
      rate_limit_response_count: number;
      rate_limited_count: number;
      skipped_after_budget_count: number;
      failed_count: number;
      retry_attempts_total: number;
      stopped_after_budget: boolean;
      parse_strategy: ConnectorParseStrategy;
      retry_strategy: "shared_budget" | "progressive_backoff";
      base_pause_between_receipts_ms: number;
      max_retry_pause_ms: number;
      window_limit?: number;
      window_ms?: number;
      window_cooldown_count?: number;
      window_cooldown_total_ms?: number;
    };
    preflight_enrichment_skip_count?: number;
    fulfilled_skip_count?: number;
    out_of_range_skip_count?: number;
  };
}

interface MapOperationRecordOptions {
  extractionMethod: "api" | "dom";
}

type MapOperationDropReason = "invalid_record" | "invalid_operation" | "missing_time_or_amount";

function normalizeParseStrategy(value: unknown): ConnectorParseStrategy | null {
  return value === "fast" || value === "full" ? value : null;
}

function resolveParseStrategy(session?: Record<string, unknown>): ConnectorParseStrategy {
  const topLevel = normalizeParseStrategy(session?.parse_strategy);
  if (topLevel) return topLevel;
  return (
    normalizeParseStrategy(asObject(session?.meta)?.parse_strategy) ??
    DEFAULT_RECEIPT_PARSE_STRATEGY
  );
}

export function estimateFullModeReceiptEnrichmentMs(receiptRequestCount: number): number {
  const normalizedCount = Math.max(0, Math.floor(receiptRequestCount));
  if (normalizedCount <= 0) return 0;

  let timelineMs = 0;
  const requestStartedAtMs: number[] = [];

  for (let index = 0; index < normalizedCount; index += 1) {
    if (index > 0) {
      timelineMs += FULL_RECEIPT_BASE_PAUSE_MS;
    }

    while (
      requestStartedAtMs.length > 0 &&
      timelineMs - requestStartedAtMs[0]! >= FULL_RECEIPT_WINDOW_MS
    ) {
      requestStartedAtMs.shift();
    }

    while (requestStartedAtMs.length >= FULL_RECEIPT_WINDOW_LIMIT) {
      const oldestStartedAtMs = requestStartedAtMs[0];
      if (typeof oldestStartedAtMs !== "number") break;
      timelineMs = oldestStartedAtMs + FULL_RECEIPT_WINDOW_MS + FULL_RECEIPT_WINDOW_BUFFER_MS;

      while (
        requestStartedAtMs.length > 0 &&
        timelineMs - requestStartedAtMs[0]! >= FULL_RECEIPT_WINDOW_MS
      ) {
        requestStartedAtMs.shift();
      }
    }

    requestStartedAtMs.push(timelineMs);
  }

  const requestResponseBudgetMs = normalizedCount * FULL_RECEIPT_RESPONSE_OVERHEAD_MS;
  return timelineMs + requestResponseBudgetMs + FULL_RECEIPT_FINALIZATION_BUFFER_MS;
}

export function buildOperationRanges(
  windowFromMs: number,
  nowMs = Date.now(),
  chunkDays = 14,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const chunkMs = Math.max(1, chunkDays) * DAY_MS;
  let cursorEnd = Math.max(windowFromMs, nowMs);

  while (cursorEnd >= windowFromMs) {
    const start = Math.max(windowFromMs, cursorEnd - chunkMs + 1);
    ranges.push({ start, end: cursorEnd });
    if (start <= windowFromMs) break;
    cursorEnd = start - 1;
  }

  return ranges;
}

export function mapOperationRecordToRow(
  recordInput: unknown,
  options: MapOperationRecordOptions,
): JsonMap | null {
  return mapOperationRecordToRowWithReason(recordInput, options).row;
}

function operationHasShoppingReceipt(operation: JsonMap): boolean {
  const documents = Array.isArray(operation.documents) ? operation.documents : [];
  return (
    Boolean(operation.hasShoppingReceipt) ||
    documents.some((documentValue) => {
      const normalized = String(documentValue).toLowerCase();
      return normalized === "shoppingreceipt";
    })
  );
}

function extractReceiptRequestKey(operation: JsonMap): string | null {
  return (
    firstNonEmpty(
      normalizeText(operation.authorizationId),
      normalizeText(asObject(operation.operationId)?.value),
      normalizeText(operation.id),
    ) ?? null
  );
}

function extractReceiptResultCode(receipt: JsonMap | null): string | null {
  return normalizeText(receipt?.resultCode)?.toUpperCase() ?? null;
}

function extractReceiptMessage(receipt: JsonMap | null): string | null {
  return (
    firstNonEmpty(
      normalizeText(receipt?.plainMessage),
      normalizeText(receipt?.errorMessage),
      normalizeText(asObject(receipt?.details)?.message),
    ) ?? null
  );
}

function hasReceiptItems(receipt: JsonMap | null): boolean {
  const payloadReceipt =
    asObject(asObject(receipt?.payload)?.receipt) ?? asObject(receipt?.receipt);
  const rawItems = Array.isArray(payloadReceipt?.items) ? payloadReceipt.items : [];
  return rawItems.length > 0;
}

function buildShoppingReceiptMeta(
  operation: JsonMap,
  shoppingReceipt: JsonMap | null,
  metaInput?: ShoppingReceiptEnrichmentMeta | null,
): ShoppingReceiptEnrichmentMeta {
  if (metaInput) return metaInput;

  const expected = operationHasShoppingReceipt(operation);
  const receiptRequestKey = extractReceiptRequestKey(operation);
  if (!expected) {
    return {
      receipt_request_key: receiptRequestKey,
      receipt_enrichment_status: "not_requested",
      receipt_line_items_skipped: false,
      receipt_retryable: false,
      receipt_retry_attempts: 0,
      receipt_result_code: null,
      receipt_tracking_id: null,
      receipt_message: null,
      skip_reason: null,
      expected: false,
      requested: false,
    };
  }

  const resultCode = extractReceiptResultCode(shoppingReceipt);
  if (hasReceiptItems(shoppingReceipt)) {
    return {
      receipt_request_key: receiptRequestKey,
      receipt_enrichment_status: "ok",
      receipt_line_items_skipped: false,
      receipt_retryable: false,
      receipt_retry_attempts: 0,
      receipt_result_code: resultCode,
      receipt_tracking_id: normalizeText(shoppingReceipt?.trackingId),
      receipt_message: extractReceiptMessage(shoppingReceipt),
      skip_reason: null,
      expected: true,
      requested: Boolean(shoppingReceipt),
    };
  }

  if (resultCode === "REQUEST_RATE_LIMIT_EXCEEDED") {
    return {
      receipt_request_key: receiptRequestKey,
      receipt_enrichment_status: "rate_limited",
      receipt_line_items_skipped: true,
      receipt_retryable: true,
      receipt_retry_attempts: 0,
      receipt_result_code: resultCode,
      receipt_tracking_id: normalizeText(shoppingReceipt?.trackingId),
      receipt_message: extractReceiptMessage(shoppingReceipt),
      skip_reason: null,
      expected: true,
      requested: true,
    };
  }

  if (!shoppingReceipt) {
    return {
      receipt_request_key: receiptRequestKey,
      receipt_enrichment_status: "error",
      receipt_line_items_skipped: true,
      receipt_retryable: false,
      receipt_retry_attempts: 0,
      receipt_result_code: null,
      receipt_tracking_id: null,
      receipt_message: "Receipt details were not captured.",
      skip_reason: null,
      expected: true,
      requested: false,
    };
  }

  return {
    receipt_request_key: receiptRequestKey,
    receipt_enrichment_status: "error",
    receipt_line_items_skipped: true,
    receipt_retryable: false,
    receipt_retry_attempts: 0,
    receipt_result_code: resultCode,
    receipt_tracking_id: normalizeText(shoppingReceipt?.trackingId),
    receipt_message: extractReceiptMessage(shoppingReceipt),
    skip_reason: null,
    expected: true,
    requested: true,
  };
}

function mapOperationRecordToRowWithReason(
  recordInput: unknown,
  options: MapOperationRecordOptions,
): { row: JsonMap | null; dropReason?: MapOperationDropReason } {
  const record = asObject(recordInput);
  if (!record) return { row: null, dropReason: "invalid_record" };

  const operation = asObject(record.operation);
  if (!operation) return { row: null, dropReason: "invalid_operation" };

  const postedAtMs = extractOperationTimeMs(operation);
  const baseAmount = extractOperationAmount(operation);
  if (postedAtMs === null || baseAmount === null) {
    return { row: null, dropReason: "missing_time_or_amount" };
  }

  const operationDetail = asObject(record.operationDetail);
  const shoppingReceipt = asObject(record.shoppingReceipt);
  const shoppingReceiptMeta = buildShoppingReceiptMeta(
    operation,
    shoppingReceipt,
    asObject(record.shoppingReceiptMeta) as ShoppingReceiptEnrichmentMeta | null,
  );
  const trancheOffers = asObject(record.trancheOffers);
  const signedAmount = resolveSignedAmount(operation, baseAmount);
  const merchantName =
    firstNonEmpty(
      normalizeText(operation.description),
      normalizeText(asObject(operation.merchant)?.name),
      normalizeText(asObject(asObject(operation.subgroup)?.name)?.toString()),
    ) ?? "T-Bank operation";
  const comment =
    firstNonEmpty(
      normalizeText(operation.message),
      normalizeText(operation.comment),
      normalizeText(asObject(operationDetail?.payload)?.message),
      normalizeText(asObject(operationDetail?.payload)?.comment),
      normalizeText(operationDetail?.comment),
    ) ?? null;
  const isTransfer = detectTransfer(operation, merchantName);
  const cashbackAmount = extractCashbackAmount(operation);
  const cashbackCurrency = extractCashbackCurrency(operation, cashbackAmount);
  const mcc = normalizeMcc(
    operation.mccString ?? operation.mcc ?? asObject(asObject(operation.merchant)?.mcc)?.value,
  );
  const accountHint = extractCardLast4FromOperation(operation, merchantName, isTransfer);
  const transactionType = isTransfer ? "transfer" : signedAmount >= 0 ? "income" : "expense";
  const externalId =
    firstNonEmpty(
      normalizeText(operation.id),
      normalizeText(asObject(operation.operationId)?.value),
      normalizeText(operation.authorizationId),
    ) ?? null;
  const postedAt = new Date(postedAtMs).toISOString();
  const sourceBrand = extractSourceBrand(operation);
  const sourceCategory = extractSourceCategory(operation);
  const operationIconUrl = extractAbsoluteUrl(operation.icon);
  const allDetailsCaptured =
    !shoppingReceiptMeta.expected || shoppingReceiptMeta.receipt_enrichment_status === "ok";

  return {
    row: {
      account_id: null,
      card_id: null,
      source: "tbank",
      external_id: externalId,
      posted_at: postedAt,
      amount: signedAmount,
      currency: extractCurrency(operation),
      transaction_type: transactionType,
      status: normalizeStatus(operation.status),
      merchant_name: merchantName,
      mcc,
      comment,
      source_comment: comment,
      cashback_amount: cashbackAmount,
      cashback_currency: cashbackCurrency,
      operation_icon_url: operationIconUrl,
      source_category: sourceCategory,
      source_brand: sourceBrand,
      receipt_request_key: shoppingReceiptMeta.receipt_request_key,
      receipt_enrichment_status: shoppingReceiptMeta.receipt_enrichment_status,
      receipt_line_items_skipped: shoppingReceiptMeta.receipt_line_items_skipped,
      receipt_retryable: shoppingReceiptMeta.receipt_retryable,
      receipt_retry_attempts: shoppingReceiptMeta.receipt_retry_attempts,
      receipt_result_code: shoppingReceiptMeta.receipt_result_code,
      receipt_tracking_id: shoppingReceiptMeta.receipt_tracking_id,
      receipt_message: shoppingReceiptMeta.receipt_message,
      is_transfer: isTransfer,
      transfer_group_id: null,
      raw_payload: {
        connector_source: "tbank_web",
        extraction_method: options.extractionMethod,
        all_details_captured: allDetailsCaptured,
        account_hint: accountHint,
        operation,
        operation_detail: operationDetail,
        shopping_receipt: shoppingReceipt,
        tranche_offers: trancheOffers,
        enrichment: {
          shopping_receipt: {
            expected: shoppingReceiptMeta.expected,
            requested: shoppingReceiptMeta.requested,
            receipt_request_key: shoppingReceiptMeta.receipt_request_key,
            status: shoppingReceiptMeta.receipt_enrichment_status,
            retryable: shoppingReceiptMeta.receipt_retryable,
            retry_attempts: shoppingReceiptMeta.receipt_retry_attempts,
            line_items_skipped: shoppingReceiptMeta.receipt_line_items_skipped,
            skip_reason: shoppingReceiptMeta.skip_reason ?? null,
            result_code: shoppingReceiptMeta.receipt_result_code,
            tracking_id: shoppingReceiptMeta.receipt_tracking_id,
            message: shoppingReceiptMeta.receipt_message,
          },
        },
      },
      dedupe_hash: buildDedupeHash({
        external_id: externalId,
        posted_at: postedAt,
        amount: signedAmount,
        merchant_name: merchantName,
        account_hint: accountHint,
        operation_id: normalizeText(asObject(operation.operationId)?.value),
        authorization_id: normalizeText(operation.authorizationId),
      }),
      line_items: buildLineItemsFromReceipt(shoppingReceipt, signedAmount, merchantName),
    },
  };
}

function extractAbsoluteUrl(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return /^https?:$/i.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function isBankNativeBrandLabel(value: unknown): boolean {
  const text = normalizeText(value)?.toLowerCase();
  if (!text) return false;

  return /внутрибанковский перевод|внутрибанк(?:овский)? перевод|перевод 3-м лицам|перевод третьим лицам|между своими счетами|пополнение по номеру телефона|закрытие вклада|пополнение вклада|проценты на остаток|кэшбэк за обычные покупки|cashback payout|balance interest/.test(
    text,
  );
}

function extractSourceBrand(operation: JsonMap): JsonMap | null {
  const brand = asObject(operation.brand);
  if (!brand) return null;

  const name = normalizeText(brand.name);
  if (!name) return null;
  const sourceKey =
    normalizeText(brand.id) ??
    normalizeText(operation.merchantKey) ??
    normalizeText(asObject(operation.merchant)?.id) ??
    name;
  if (isBankNativeBrandLabel(name) || isBankNativeBrandLabel(sourceKey)) return null;

  return {
    source_key: sourceKey,
    name,
    website_url: extractAbsoluteUrl(brand.link),
    logo_url: extractAbsoluteUrl(brand.logo) ?? extractAbsoluteUrl(brand.fileLink),
    base_color: normalizeText(brand.baseColor),
    base_text_color: normalizeText(brand.baseTextColor),
  };
}

function extractSourceCategory(operation: JsonMap): JsonMap | null {
  const bankCategory = asObject(asObject(operation.categoryInfo)?.bankCategory);
  if (!bankCategory) return null;

  const id = normalizeText(bankCategory.id);
  const name = normalizeText(bankCategory.name);
  if (!id && !name) return null;

  return {
    id,
    name,
  };
}

function formatDiagnosticError(message: string, details: Record<string, unknown>): Error {
  const normalizedMessage = message.trim();
  const separator = /[.!?]$/.test(normalizedMessage) ? "" : ".";
  return new Error(`${normalizedMessage}${separator} diagnostics=${JSON.stringify(details)}`);
}

function countRowsWithoutLineItems(rows: JsonMap[]): number {
  let count = 0;
  for (const row of rows) {
    const lineItems = (asObject(row)?.line_items as unknown) ?? null;
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      count += 1;
    }
  }
  return count;
}

function sanitizeDebugUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const params: string[] = [];
    for (const [key] of parsed.searchParams.entries()) {
      params.push(`${key}=<redacted>`);
    }
    const query = params.length > 0 ? `?${params.sort().join("&")}` : "";
    return `${parsed.origin}${parsed.pathname}${query}`;
  } catch {
    return null;
  }
}

function summarizeExtractionDiagnostics(
  extraction: PageExtraction,
  mappingDropCounts: Record<string, number>,
  mappedRowCount: number,
  parseStrategy: ConnectorParseStrategy,
): NonNullable<ConnectorParseOutput["debug"]> {
  const debug = extraction.debug;
  const firstRangeAttempt = debug?.range_attempts?.[0];
  const receiptDebug = debug?.receipt_enrichment;
  return {
    extraction_method: debug?.extraction_method ?? extraction.method,
    fallback_used: debug?.fallback_used ?? extraction.method === "dom",
    fallback_reason: debug?.fallback_reason ?? null,
    blocked_reason: debug?.blocked_reason ?? extraction.blocked_reason ?? null,
    discovered_endpoints: {
      operations_api: sanitizeDebugUrl(debug?.discovered_endpoints?.operations_api ?? null),
      operation_detail_api: sanitizeDebugUrl(
        debug?.discovered_endpoints?.operation_detail_api ?? null,
      ),
      tranche_offers_api: sanitizeDebugUrl(debug?.discovered_endpoints?.tranche_offers_api ?? null),
    },
    range_attempts: debug?.range_attempts ?? [],
    range_request_count: debug?.range_request_count ?? debug?.range_attempts?.length ?? 0,
    effective_chunk_span_days:
      debug?.effective_chunk_span_days ??
      (firstRangeAttempt
        ? Math.max(1, Math.round((firstRangeAttempt.end - firstRangeAttempt.start + 1) / DAY_MS))
        : null),
    first_operation_posted_at: debug?.first_operation_posted_at ?? null,
    last_operation_posted_at: debug?.last_operation_posted_at ?? null,
    page_originated_operations_request_seen:
      debug?.page_originated_operations_request_seen ?? false,
    response_status_histogram: debug?.response_status_histogram ?? {},
    stage_timings_ms: debug?.stage_timings_ms ?? {},
    mapping_drop_counts: mappingDropCounts,
    api_operation_count: debug?.api_operation_count ?? 0,
    mapped_row_count: mappedRowCount,
    rows_without_line_items: 0,
    receipt_enrichment: {
      requested_count: receiptDebug?.requested_count ?? 0,
      success_count: receiptDebug?.success_count ?? 0,
      rate_limit_response_count: receiptDebug?.rate_limit_response_count ?? 0,
      rate_limited_count: receiptDebug?.rate_limited_count ?? 0,
      skipped_after_budget_count: receiptDebug?.skipped_after_budget_count ?? 0,
      failed_count: receiptDebug?.failed_count ?? 0,
      retry_attempts_total: receiptDebug?.retry_attempts_total ?? 0,
      stopped_after_budget: receiptDebug?.stopped_after_budget ?? false,
      parse_strategy: receiptDebug?.parse_strategy ?? parseStrategy,
      retry_strategy:
        receiptDebug?.retry_strategy ??
        (parseStrategy === "full" ? "progressive_backoff" : "shared_budget"),
      base_pause_between_receipts_ms:
        receiptDebug?.base_pause_between_receipts_ms ??
        (parseStrategy === "full" ? FULL_RECEIPT_BASE_PAUSE_MS : 300),
      max_retry_pause_ms:
        receiptDebug?.max_retry_pause_ms ?? (parseStrategy === "full" ? 15000 : 1500),
      window_limit: receiptDebug?.window_limit,
      window_ms: receiptDebug?.window_ms,
      window_cooldown_count: receiptDebug?.window_cooldown_count ?? 0,
      window_cooldown_total_ms: receiptDebug?.window_cooldown_total_ms ?? 0,
    },
    preflight_enrichment_skip_count: debug?.preflight_enrichment_skip_count ?? 0,
    fulfilled_skip_count: debug?.fulfilled_skip_count ?? 0,
    out_of_range_skip_count: debug?.out_of_range_skip_count ?? 0,
  };
}

const connector: Connector = {
  sourceId: "tbank_web",
  displayName: "T-Bank Web",
  parseStrategies: ["fast", "full"],
  async parse({
    windowFrom,
    windowTo,
    session,
    debug,
  }: ConnectorParseInput): Promise<ConnectorParseOutput> {
    const emitProgress = async (
      phase: string,
      progressPercent: number,
      parsedTransactionsCount?: number | null,
    ) => {
      await debug?.on_progress?.({
        phase,
        progress_percent: progressPercent,
        parsed_transactions_count: parsedTransactionsCount ?? null,
      });
    };
    const fallbackWindowFromIso = new Date(
      Date.now() - DEFAULT_LOOKBACK_DAYS * DAY_MS,
    ).toISOString();
    const parseStrategy = resolveParseStrategy(session);
    const normalizedWindowFrom =
      toIsoString(windowFrom) || toIsoString(session?.last_imported_at) || fallbackWindowFromIso;
    // A backfill slice is bounded at both ends, and until this was threaded through only its
    // start was honoured: a slice planned as one month read from its start through to today.
    // Each run then did more work than the last and re-imported everything newer, which is also
    // how the receipt budget got exhausted on every deep slice -- and an exhausted budget holds
    // the cursor, so the walk stalled while the runs grew.
    const normalizedWindowTo = toIsoString(windowTo);

    const activeTab =
      typeof debug?.tab_id === "number"
        ? await chrome.tabs.get(debug.tab_id).catch(() => null)
        : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!activeTab?.id) {
      throw new Error("No active tab. Open T-Bank in a tab first.");
    }

    await emitProgress("parse_preparing_tab", 5);

    if (!isTbankUrl(activeTab.url)) {
      throw new Error("Active tab is not a T-Bank page. Open https://www.tbank.ru/ and try again.");
    }

    await emitProgress("parse_loading_operations_page", 10);
    const readyTab = await prepareOperationsTab(activeTab);
    if (typeof readyTab.id !== "number") {
      throw new Error("No active tab. Open T-Bank in a tab first.");
    }
    await emitProgress("parse_extracting_page_data", 14);
    const extraction = await extractOperationsWithRetry(
      readyTab.id,
      normalizedWindowFrom,
      normalizedWindowTo,
      typeof session?.session_id === "string" ? session.session_id : null,
      typeof session?.source === "string" ? session.source : "tbank_web",
      typeof session?.payer_person_id === "string" ? session.payer_person_id : null,
      parseStrategy,
      resolveExtractionDeadlineMs(session),
    );
    if (extraction.blocked_reason) {
      throw formatDiagnosticError(extraction.blocked_reason, {
        blocked_reason: extraction.blocked_reason,
        extraction_method: extraction.method,
      });
    }

    const mappingDropCounts: Record<MapOperationDropReason, number> = {
      invalid_record: 0,
      invalid_operation: 0,
      missing_time_or_amount: 0,
    };

    await emitProgress(
      "parse_mapping_rows",
      58,
      typeof extraction.parsed_transactions_count === "number"
        ? extraction.parsed_transactions_count
        : null,
    );

    const rows =
      extraction.method === "api"
        ? ((extraction.operation_records ?? [])
            .map((record) => {
              const mapped = mapOperationRecordToRowWithReason(record, {
                extractionMethod: "api",
              });
              if (!mapped.row && mapped.dropReason) {
                mappingDropCounts[mapped.dropReason] += 1;
              }
              return mapped.row;
            })
            .filter(Boolean) as JsonMap[])
        : Array.isArray(extraction.rows)
          ? extraction.rows
          : [];

    const debugSummary = summarizeExtractionDiagnostics(
      extraction,
      mappingDropCounts,
      rows.length,
      parseStrategy,
    );
    debugSummary.rows_without_line_items = countRowsWithoutLineItems(rows);

    if (extraction.method === "dom" && rows.length === 0 && extraction.debug?.fallback_used) {
      throw formatDiagnosticError("T-Bank extraction failed: DOM fallback returned zero rows", {
        debug: debugSummary,
      });
    }

    return {
      rows,
      windowTo: toIsoString(extraction.window_to) || new Date().toISOString(),
      parsedThroughAt: toIsoString(extraction.parsed_through_at) || normalizedWindowFrom,
      parsedTransactionsCount:
        typeof extraction.parsed_transactions_count === "number"
          ? extraction.parsed_transactions_count
          : rows.length,
      debug: debugSummary,
    };
  },
};

registerConnector(connector);

export default connector;

export const __test__ = {
  isOperationsPageUrl,
  buildOperationRanges,
  detectBlockedReasonFromApiEnvelope,
  detectBlockedReasonFromPageState,
  estimateFullModeReceiptEnrichmentMs,
  extractOperationsInPage,
  findLatestResourceUrlByPath,
  mapOperationRecordToRow,
};

function detectBlockedReasonFromApiEnvelope(value: unknown): string | null {
  const envelope = asObject(value);
  if (!envelope) return null;

  const details = asObject(envelope.details);
  const resultCode = normalizeText(envelope.resultCode)?.toUpperCase() ?? "";
  const errorCode = normalizeText(details?.errorCode)?.toUpperCase() ?? "";
  const httpStatusCode = toFiniteNumber(details?.httpStatusCode);
  const errorMessage = [
    normalizeText(envelope.errorMessage),
    normalizeText(details?.message),
    normalizeText(details?.errorCode),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (
    resultCode === "AUTHENTICATION_FAILED" ||
    errorCode === "INSUFFICIENT_PRIVILEGES" ||
    httpStatusCode === 401 ||
    /authentication failed|insufficient privileges|not authorized/.test(errorMessage) ||
    /не указан пользователь|пользователь не найден|недостаточно прав/.test(errorMessage)
  ) {
    return "T-Bank session is not authorized. Sign in and retry import.";
  }

  if (
    /captcha|verify you are human|too many requests|checking your browser/.test(errorMessage) ||
    /капча|подтвердите|слишком много запросов/.test(errorMessage)
  ) {
    return "T-Bank requested verification. Resolve blocking challenge and retry import.";
  }

  return null;
}

function detectBlockedReasonFromPageState(pageUrl: string, pageText: string): string | null {
  const normalizedUrl = pageUrl.trim().toLowerCase();
  const text = pageText.slice(0, 6000).toLowerCase();
  const looksLikeLoginUrl =
    normalizedUrl.includes("/auth/login") ||
    /\/login(?:[/?#]|$)/.test(normalizedUrl) ||
    normalizedUrl.includes("redirectto=");

  if (
    looksLikeLoginUrl ||
    /sign in|log in|login/.test(text) ||
    /\u0432\u043e\u0439\u0442\u0438|\u0430\u0432\u0442\u043e\u0440\u0438\u0437/.test(text)
  ) {
    return "T-Bank session is not authorized. Sign in and retry import.";
  }
  if (
    /captcha|verify you are human|too many requests|checking your browser/.test(text) ||
    /\u043a\u0430\u043f\u0447\u0430|\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435/.test(
      text,
    )
  ) {
    return "T-Bank requested verification. Resolve blocking challenge and retry import.";
  }
  return null;
}

function detectBlockedReasonFromTabUrl(tabUrl: unknown): string | null {
  if (typeof tabUrl !== "string" || !tabUrl.trim()) return null;
  return detectBlockedReasonFromPageState(tabUrl, "");
}

async function prepareOperationsTab(tab: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  if (typeof tab.id !== "number") {
    throw new Error("No active tab. Open T-Bank in a tab first.");
  }
  const tabId = tab.id;
  if (!isTbankUrl(tab.url)) {
    throw new Error("Active tab is not a T-Bank page. Open https://www.tbank.ru/ and try again.");
  }

  const initialBlockedReason = detectBlockedReasonFromTabUrl(tab.url);
  if (initialBlockedReason) {
    throw formatDiagnosticError(initialBlockedReason, {
      tab_url: tab.url ?? null,
      tab_status: tab.status ?? null,
    });
  }

  let currentTab = tab;
  const shouldWaitForLoad = currentTab.status === "loading";

  if (!isOperationsPageUrl(currentTab.url)) {
    await chrome.tabs.update(tabId, { url: OPERATIONS_PAGE_URL });
    currentTab = (await waitForTabLoad(tabId)) ?? currentTab;
  } else if (shouldWaitForLoad) {
    currentTab = (await waitForTabLoad(tabId)) ?? currentTab;
  }

  const blockedReason = detectBlockedReasonFromTabUrl(currentTab.url);
  if (blockedReason) {
    throw formatDiagnosticError(blockedReason, {
      tab_url: currentTab.url ?? null,
      tab_status: currentTab.status ?? null,
    });
  }

  if (!isOperationsPageUrl(currentTab.url)) {
    throw formatDiagnosticError("T-Bank did not stay on the operations page", {
      tab_url: currentTab.url ?? null,
      tab_status: currentTab.status ?? null,
    });
  }

  return currentTab;
}

async function extractOperationsWithRetry(
  tabId: number,
  windowFromIso: string,
  windowToIso: string | null,
  sessionId: string | null,
  sourceId: string | null,
  payerPersonId: string | null,
  parseStrategy: ConnectorParseStrategy,
  deadlineMs: number,
): Promise<PageExtraction> {
  const attemptDetails: Array<Record<string, unknown>> = [];

  for (let attempt = 1; attempt <= EXTRACTION_ATTEMPTS; attempt += 1) {
    const currentTab = await getTabById(tabId);
    const blockedReason = detectBlockedReasonFromTabUrl(currentTab?.url);
    if (blockedReason) {
      throw formatDiagnosticError(blockedReason, {
        tab_url: currentTab?.url ?? null,
        tab_status: currentTab?.status ?? null,
        execute_script_attempts: attemptDetails,
      });
    }

    try {
      const extraction = await runPageExtraction(
        tabId,
        { windowFromIso, windowToIso, sessionId, sourceId, payerPersonId, parseStrategy },
        deadlineMs,
      );
      if (extraction) {
        return extraction;
      }

      attemptDetails.push({
        attempt,
        result_count: 0,
        tab_url: currentTab?.url ?? null,
        tab_status: currentTab?.status ?? null,
      });
    } catch (error) {
      attemptDetails.push({
        attempt,
        error_message: error instanceof Error ? error.message : String(error),
        tab_url: currentTab?.url ?? null,
        tab_status: currentTab?.status ?? null,
      });
    }

    if (attempt < EXTRACTION_ATTEMPTS) {
      await waitForTabLoad(tabId, 5000).catch(() => null);
    }
  }

  const finalTab = await getTabById(tabId);
  throw formatDiagnosticError("Unable to extract operations from current page", {
    tab_url: finalTab?.url ?? null,
    tab_status: finalTab?.status ?? null,
    execute_script_attempts: attemptDetails,
  });
}

/**
 * How long the page may take to report: until the session it works for is over, which is when
 * the upload would be refused anyway. A minute at least, so a session already near its end
 * still gets its answer rather than a timeout racing the parse.
 */
function resolveExtractionDeadlineMs(session: Record<string, unknown> | undefined): number {
  const expiresAt = toIsoString(session?.expires_at);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAtMs)) return expiresAtMs + 60_000;
  return Date.now() + DEFAULT_EXTRACTION_TIMEOUT_MS;
}

function isPageExtractionStart(value: unknown): value is PageExtractionStart {
  const candidate = asObject(value);
  return (
    candidate !== null &&
    candidate.started === true &&
    typeof candidate.report_token === "string" &&
    candidate.report_token.length > 0
  );
}

/**
 * Runs the in-page extractor and waits for what it reports.
 *
 * The extractor is asked to return at once and report by message: `executeScript` is one
 * extension API call, and Chrome ends a service worker whose single call is still open after
 * five minutes. A full parse, with its pauses for the bank's rate limit, ran inside that call
 * and died there with its session left running (2026-09-03, 2026-09-04). The wait here is a
 * promise in a worker kept alive for the run, which no five-minute rule applies to. An
 * extractor that answers within the call -- a test double, an older page -- is taken at its
 * word. Resolves undefined when the page answered nothing, as before.
 */
async function runPageExtraction(
  tabId: number,
  args: {
    windowFromIso: string;
    windowToIso: string | null;
    sessionId: string | null;
    sourceId: string | null;
    payerPersonId: string | null;
    parseStrategy: ConnectorParseStrategy;
  },
  deadlineMs: number,
): Promise<PageExtraction | undefined> {
  const runtime = globalThis.chrome?.runtime;
  const tabs = globalThis.chrome?.tabs;
  // Absent in a test double or an older browser: then the call is awaited, as before.
  const messageEvents = runtime?.onMessage ?? null;
  const tabEvents = tabs?.onRemoved ?? null;
  const reportToken =
    messageEvents && tabEvents
      ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      : null;

  let settled = false;
  let resolveReport: (extraction: PageExtraction) => void = () => undefined;
  let rejectReport: (error: Error) => void = () => undefined;
  const reported = new Promise<PageExtraction>((resolve, reject) => {
    resolveReport = (extraction) => {
      settled = true;
      resolve(extraction);
    };
    rejectReport = (error) => {
      settled = true;
      reject(error);
    };
  });
  // A report that arrives after the timeout won the race must not surface as unhandled.
  void reported.catch(() => undefined);

  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
    const payload = asObject(message);
    if (!payload) return;
    if (payload.type !== PAGE_EXTRACTION_MESSAGE || payload.report_token !== reportToken) return;
    if (typeof sender?.tab?.id === "number" && sender.tab.id !== tabId) return;
    if (payload.ok === true) {
      resolveReport(payload.result as PageExtraction);
      return;
    }
    rejectReport(
      new Error(
        typeof payload.error_message === "string" && payload.error_message
          ? payload.error_message
          : "T-Bank extraction failed in the page",
      ),
    );
  };
  const onRemoved = (removedTabId: number) => {
    if (removedTabId !== tabId) return;
    rejectReport(new Error("T-Bank tab was closed before the extraction finished"));
  };
  if (reportToken && messageEvents && tabEvents) {
    messageEvents.addListener(onMessage);
    tabEvents.addListener(onRemoved);
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractOperationsInPage,
      args: [reportToken ? { ...args, reportToken } : args],
    });
    const first = injected?.[0]?.result as PageExtraction | PageExtractionStart | undefined;
    if (!first) return undefined;
    if (!isPageExtractionStart(first)) return first;
    if (!reportToken) return undefined;

    const timeoutMs = Math.max(60_000, deadlineMs - Date.now());
    return await Promise.race([
      reported,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          if (settled) return;
          reject(new Error("T-Bank extraction did not report back before its session ended"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (reportToken && messageEvents && tabEvents) {
      messageEvents.removeListener(onMessage);
      tabEvents.removeListener(onRemoved);
    }
  }
}

function findLatestResourceUrlByPath(
  resourceUrls: string[],
  exactPath: string,
  baseOrigin = "https://www.tbank.ru",
): string | null {
  for (let index = resourceUrls.length - 1; index >= 0; index -= 1) {
    const candidate = resourceUrls[index];
    if (typeof candidate !== "string") continue;
    try {
      const parsed = new URL(candidate, baseOrigin);
      if (parsed.pathname === exactPath) {
        return parsed.toString();
      }
    } catch {
      continue;
    }
  }
  return null;
}

function extractOperationsInPage(input: {
  windowFromIso?: string;
  windowToIso?: string | null;
  sessionId?: string | null;
  sourceId?: string | null;
  payerPersonId?: string | null;
  parseStrategy?: ConnectorParseStrategy | null;
  reportToken?: string | null;
}): Promise<PageExtraction> | PageExtractionStart {
  const reportToken =
    typeof input.reportToken === "string" && input.reportToken ? input.reportToken : null;
  if (reportToken) {
    // Chrome ends an extension service worker whose single API call is still open after five
    // minutes, and executeScript is one call. The parse below, with its pauses for the bank's
    // rate limit, used to run inside that call -- a month with receipts died at five minutes,
    // its session left running (2026-09-03, 2026-09-04). Asked to report, this returns at once
    // and the parse goes on in this page, telling the worker what it found by message. The
    // function calls itself for the parse: serialized for injection it is a named function
    // expression, and the name stays bound inside.
    const report = (payload: Record<string, unknown>) => {
      try {
        const sent: unknown = globalThis.chrome?.runtime?.sendMessage?.({
          type: "MONEY_IMPORT_PAGE_EXTRACTION",
          report_token: reportToken,
          ...payload,
        });
        if (typeof (sent as { catch?: unknown } | null | undefined)?.catch === "function") {
          (sent as Promise<unknown>).catch(() => undefined);
        }
      } catch {
        // The worker that asked is gone; there is nobody to tell.
      }
    };
    void Promise.resolve(extractOperationsInPage({ ...input, reportToken: null })).then(
      (result) => report({ ok: true, result }),
      (error: unknown) =>
        report({
          ok: false,
          error_message: error instanceof Error ? error.message : String(error),
        }),
    );
    return { started: true, report_token: reportToken };
  }
  const fullReceiptBasePauseMs = 4000;
  const receiptParseStrategy =
    input.parseStrategy === "fast" || input.parseStrategy === "full" ? input.parseStrategy : "fast";
  const receiptBasePauseBetweenRequestsMs =
    receiptParseStrategy === "full" ? fullReceiptBasePauseMs : 300;
  const receiptMaxSharedRetries = 2;
  const receiptRetryPauseMs = 1500;
  const receiptFullModeMaxRetries = 8;
  const receiptFullModeMaxRetryPauseMs = 15000;
  const receiptFullModeWindowLimit = 70;
  const receiptFullModeWindowMs = 10 * 60 * 1000;
  const receiptFullModeWindowBufferMs = 5000;
  const receiptRetryStrategy: "shared_budget" | "progressive_backoff" =
    receiptParseStrategy === "full" ? "progressive_backoff" : "shared_budget";
  const progressSessionId = input.sessionId ?? null;

  function computeReceiptRetryPauseMs(retryAttempts: number): number {
    if (receiptParseStrategy !== "full") return receiptRetryPauseMs;
    const retryExponent = Math.max(0, retryAttempts - 1);
    return Math.min(receiptRetryPauseMs * 2 ** retryExponent, receiptFullModeMaxRetryPauseMs);
  }

  function estimateReceiptEnrichmentMs(receiptRequestCount: number): number {
    const normalizedCount = Math.max(0, Math.floor(receiptRequestCount));
    if (normalizedCount <= 1) return 0;

    let timelineMs = 0;
    const requestStartedAtMs: number[] = [];

    for (let index = 0; index < normalizedCount; index += 1) {
      if (index > 0) {
        timelineMs += receiptBasePauseBetweenRequestsMs;
      }

      while (
        requestStartedAtMs.length > 0 &&
        timelineMs - requestStartedAtMs[0]! >= receiptFullModeWindowMs
      ) {
        requestStartedAtMs.shift();
      }

      while (requestStartedAtMs.length >= receiptFullModeWindowLimit) {
        const oldestStartedAtMs = requestStartedAtMs[0];
        if (typeof oldestStartedAtMs !== "number") break;
        timelineMs = oldestStartedAtMs + receiptFullModeWindowMs + receiptFullModeWindowBufferMs;

        while (
          requestStartedAtMs.length > 0 &&
          timelineMs - requestStartedAtMs[0]! >= receiptFullModeWindowMs
        ) {
          requestStartedAtMs.shift();
        }
      }

      requestStartedAtMs.push(timelineMs);
    }

    return timelineMs;
  }

  function operationHasShoppingReceipt(operation: JsonMap): boolean {
    const documents = Array.isArray(operation.documents) ? operation.documents : [];
    return (
      Boolean(operation.hasShoppingReceipt) ||
      documents.some((documentValue) => {
        const normalized = String(documentValue).toLowerCase();
        return normalized === "shoppingreceipt";
      })
    );
  }

  function extractReceiptRequestKey(operation: JsonMap): string | null {
    return (
      text(operation.authorizationId) ||
      text(asObj(operation.operationId)?.value) ||
      text(operation.id)
    );
  }

  function extractReceiptResultCode(receipt: JsonMap | null): string | null {
    return text(receipt?.resultCode)?.toUpperCase() ?? null;
  }

  function extractReceiptMessage(receipt: JsonMap | null): string | null {
    return (
      text(receipt?.plainMessage) ||
      text(receipt?.errorMessage) ||
      text(asObj(receipt?.details)?.message) ||
      null
    );
  }

  function hasReceiptItems(receipt: JsonMap | null): boolean {
    const payloadReceipt = asObj(asObj(receipt?.payload)?.receipt) ?? asObj(receipt?.receipt);
    const rawItems = Array.isArray(payloadReceipt?.items) ? payloadReceipt.items : [];
    return rawItems.length > 0;
  }

  function buildShoppingReceiptMeta(
    operation: JsonMap,
    shoppingReceipt: JsonMap | null,
    metaInput?: ShoppingReceiptEnrichmentMeta | null,
  ): ShoppingReceiptEnrichmentMeta {
    if (metaInput) return metaInput;

    const expected = operationHasShoppingReceipt(operation);
    const receiptRequestKey = extractReceiptRequestKey(operation);
    if (!expected) {
      return {
        receipt_request_key: receiptRequestKey,
        receipt_enrichment_status: "not_requested",
        receipt_line_items_skipped: false,
        receipt_retryable: false,
        receipt_retry_attempts: 0,
        receipt_result_code: null,
        receipt_tracking_id: null,
        receipt_message: null,
        skip_reason: null,
        expected: false,
        requested: false,
      };
    }

    const resultCode = extractReceiptResultCode(shoppingReceipt);
    if (hasReceiptItems(shoppingReceipt)) {
      return {
        receipt_request_key: receiptRequestKey,
        receipt_enrichment_status: "ok",
        receipt_line_items_skipped: false,
        receipt_retryable: false,
        receipt_retry_attempts: 0,
        receipt_result_code: resultCode,
        receipt_tracking_id: text(shoppingReceipt?.trackingId),
        receipt_message: extractReceiptMessage(shoppingReceipt),
        skip_reason: null,
        expected: true,
        requested: Boolean(shoppingReceipt),
      };
    }

    if (resultCode === "REQUEST_RATE_LIMIT_EXCEEDED") {
      return {
        receipt_request_key: receiptRequestKey,
        receipt_enrichment_status: "rate_limited",
        receipt_line_items_skipped: true,
        receipt_retryable: true,
        receipt_retry_attempts: 0,
        receipt_result_code: resultCode,
        receipt_tracking_id: text(shoppingReceipt?.trackingId),
        receipt_message: extractReceiptMessage(shoppingReceipt),
        skip_reason: null,
        expected: true,
        requested: true,
      };
    }

    if (!shoppingReceipt) {
      return {
        receipt_request_key: receiptRequestKey,
        receipt_enrichment_status: "error",
        receipt_line_items_skipped: true,
        receipt_retryable: false,
        receipt_retry_attempts: 0,
        receipt_result_code: null,
        receipt_tracking_id: null,
        receipt_message: "Receipt details were not captured.",
        skip_reason: null,
        expected: true,
        requested: false,
      };
    }

    return {
      receipt_request_key: receiptRequestKey,
      receipt_enrichment_status: "error",
      receipt_line_items_skipped: true,
      receipt_retryable: false,
      receipt_retry_attempts: 0,
      receipt_result_code: resultCode,
      receipt_tracking_id: text(shoppingReceipt?.trackingId),
      receipt_message: extractReceiptMessage(shoppingReceipt),
      skip_reason: null,
      expected: true,
      requested: true,
    };
  }

  function detectBlockedReasonFromApiEnvelope(value: unknown): string | null {
    const envelope = asObj(value);
    if (!envelope) return null;

    const details = asObj(envelope.details);
    const resultCode = text(envelope.resultCode)?.toUpperCase() ?? "";
    const errorCode = text(details?.errorCode)?.toUpperCase() ?? "";
    const httpStatusCode = toNum(details?.httpStatusCode);
    const errorMessage = [
      text(envelope.errorMessage),
      text(details?.message),
      text(details?.errorCode),
    ]
      .filter((candidate): candidate is string => Boolean(candidate))
      .join(" ")
      .toLowerCase();

    if (
      resultCode === "AUTHENTICATION_FAILED" ||
      errorCode === "INSUFFICIENT_PRIVILEGES" ||
      httpStatusCode === 401 ||
      /authentication failed|insufficient privileges|not authorized/.test(errorMessage) ||
      /не указан пользователь|пользователь не найден|недостаточно прав/.test(errorMessage)
    ) {
      return "T-Bank session is not authorized. Sign in and retry import.";
    }

    if (
      /captcha|verify you are human|too many requests|checking your browser/.test(errorMessage) ||
      /капча|подтвердите|слишком много запросов/.test(errorMessage)
    ) {
      return "T-Bank requested verification. Resolve blocking challenge and retry import.";
    }

    return null;
  }

  function detectBlockedReasonFromPageState(pageUrl: string, pageText: string): string | null {
    const normalizedUrl = pageUrl.trim().toLowerCase();
    const textValue = pageText.slice(0, 6000).toLowerCase();
    const looksLikeLoginUrl =
      normalizedUrl.includes("/auth/login") ||
      /\/login(?:[/?#]|$)/.test(normalizedUrl) ||
      normalizedUrl.includes("redirectto=");

    if (
      looksLikeLoginUrl ||
      /sign in|log in|login/.test(textValue) ||
      /войти|авториз/.test(textValue)
    ) {
      return "T-Bank session is not authorized. Sign in and retry import.";
    }
    if (
      /captcha|verify you are human|too many requests|checking your browser/.test(textValue) ||
      /капча|подтвердите/.test(textValue)
    ) {
      return "T-Bank requested verification. Resolve blocking challenge and retry import.";
    }
    return null;
  }

  function findLatestResourceUrlByPath(
    resourceUrls: string[],
    exactPath: string,
    baseOrigin = "https://www.tbank.ru",
  ): string | null {
    for (let index = resourceUrls.length - 1; index >= 0; index -= 1) {
      const candidate = resourceUrls[index];
      if (typeof candidate !== "string") continue;
      try {
        const parsed = new URL(candidate, baseOrigin);
        if (parsed.pathname === exactPath) {
          return parsed.toString();
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  return run(input);

  async function run(args: {
    windowFromIso?: string;
    windowToIso?: string | null;
    sessionId?: string | null;
  }): Promise<PageExtraction> {
    const startedAtMs = Date.now();
    const pageDayMs = 24 * 60 * 60 * 1000;
    const windowFromMs = toMs(args.windowFromIso) ?? Date.now() - 30 * pageDayMs;
    // Absent means "up to now", which is what a catch-up window wants. A history slice sends
    // its own end, and without honouring it the slice is not a slice at all.
    const windowToMs = toMs(args.windowToIso) ?? Date.now();
    const debugMeta = {
      discovered_endpoints: {
        operations_api: null as string | null,
        operation_detail_api: null as string | null,
        tranche_offers_api: null as string | null,
      },
      range_attempts: [] as Array<{
        start: number;
        end: number;
        status_code: number | null;
        payload_count: number | null;
      }>,
      range_request_count: 0,
      effective_chunk_span_days: null as number | null,
      first_operation_posted_at: null as string | null,
      last_operation_posted_at: null as string | null,
      page_originated_operations_request_seen: false,
      response_status_histogram: {} as Record<string, number>,
      stage_timings_ms: {} as Record<string, number>,
      api_error_message: null as string | null,
      api_operation_count: 0,
      dom_row_count: 0,
      receipt_enrichment: {
        requested_count: 0,
        success_count: 0,
        rate_limit_response_count: 0,
        rate_limited_count: 0,
        skipped_after_budget_count: 0,
        failed_count: 0,
        retry_attempts_total: 0,
        stopped_after_budget: false,
        parse_strategy: receiptParseStrategy,
        retry_strategy: receiptRetryStrategy,
        base_pause_between_receipts_ms: receiptBasePauseBetweenRequestsMs,
        max_retry_pause_ms:
          receiptParseStrategy === "full" ? receiptFullModeMaxRetryPauseMs : receiptRetryPauseMs,
        window_limit: receiptParseStrategy === "full" ? receiptFullModeWindowLimit : undefined,
        window_ms: receiptParseStrategy === "full" ? receiptFullModeWindowMs : undefined,
        window_cooldown_count: 0,
        window_cooldown_total_ms: 0,
      },
      preflight_enrichment_skip_count: 0,
      fulfilled_skip_count: 0,
      out_of_range_skip_count: 0,
    };

    function buildBlockedExtraction(blockedReason: string): PageExtraction {
      debugMeta.stage_timings_ms.total = Date.now() - startedAtMs;
      return {
        method: "api",
        blocked_reason: blockedReason,
        operation_records: [],
        window_to: new Date().toISOString(),
        parsed_through_at: new Date(windowFromMs).toISOString(),
        parsed_transactions_count: 0,
        debug: {
          extraction_method: "api",
          fallback_used: false,
          fallback_reason: null,
          blocked_reason: blockedReason,
          discovered_endpoints: debugMeta.discovered_endpoints,
          range_attempts: debugMeta.range_attempts,
          range_request_count: debugMeta.range_request_count,
          effective_chunk_span_days: debugMeta.effective_chunk_span_days,
          first_operation_posted_at: debugMeta.first_operation_posted_at,
          last_operation_posted_at: debugMeta.last_operation_posted_at,
          page_originated_operations_request_seen:
            debugMeta.page_originated_operations_request_seen,
          response_status_histogram: debugMeta.response_status_histogram,
          stage_timings_ms: debugMeta.stage_timings_ms,
          api_error_message: debugMeta.api_error_message,
          api_operation_count: debugMeta.api_operation_count,
          dom_row_count: 0,
          receipt_enrichment: debugMeta.receipt_enrichment,
          preflight_enrichment_skip_count: debugMeta.preflight_enrichment_skip_count,
          fulfilled_skip_count: debugMeta.fulfilled_skip_count,
          out_of_range_skip_count: debugMeta.out_of_range_skip_count,
        },
      };
    }

    const blockedReason = detectBlockedReason();
    if (blockedReason) {
      return buildBlockedExtraction(blockedReason);
    }

    reportProgress("parse_discovering_endpoints", 18);
    const apiStartedMs = Date.now();
    try {
      const operationsApiUrl =
        discoverOperationsApiUrl() || "https://www.tbank.ru/api/common/v1/operations";
      const detailApiUrl = discoverOperationDetailApiUrl();
      const trancheOffersApiUrl = discoverTrancheOffersApiUrl();
      debugMeta.discovered_endpoints.operations_api = operationsApiUrl;
      debugMeta.discovered_endpoints.operation_detail_api = detailApiUrl;
      debugMeta.discovered_endpoints.tranche_offers_api = trancheOffersApiUrl;
      debugMeta.page_originated_operations_request_seen = hasPageOriginatedOperationsRequest();

      const sessionId = discoverSessionId(operationsApiUrl) || discoverSessionIdFromResources();
      const trancheBaseParams = parseTrancheBaseParams(trancheOffersApiUrl);

      const ranges = buildRanges(windowFromMs, windowToMs);
      debugMeta.range_request_count = ranges.length;
      debugMeta.effective_chunk_span_days =
        ranges.length > 0
          ? Math.max(1, Math.round((ranges[0].end - ranges[0].start + 1) / pageDayMs))
          : null;
      const operationMap = new Map<string, JsonMap>();
      let oldestSeenMs = Number.POSITIVE_INFINITY;
      let newestSeenMs = 0;

      ranges.forEach((_range, index) => {
        if (index === 0) {
          reportProgress("parse_fetching_ranges", 20);
        }
      });

      for (const [index, range] of ranges.entries()) {
        const rangeUrl = buildRangeUrl(operationsApiUrl, range.start, range.end);
        const response = await fetch(rangeUrl, {
          credentials: "include",
        });
        const attempt = {
          start: range.start,
          end: range.end,
          status_code: response.status,
          payload_count: null as number | null,
        };
        debugMeta.range_attempts.push(attempt);
        const histogramKey = String(response.status);
        debugMeta.response_status_histogram[histogramKey] =
          (debugMeta.response_status_histogram[histogramKey] ?? 0) + 1;
        if (!response.ok) continue;

        const json = asObj(await response.json().catch(() => null));
        const apiBlockedReason = detectBlockedReasonFromApiEnvelope(json);
        if (apiBlockedReason) {
          debugMeta.api_error_message = apiBlockedReason;
          debugMeta.stage_timings_ms.api = Date.now() - apiStartedMs;
          return buildBlockedExtraction(apiBlockedReason);
        }
        const payload = Array.isArray(json?.payload) ? json.payload : [];
        attempt.payload_count = payload.length;
        for (const rawItem of payload) {
          const operation = asObj(rawItem);
          if (!operation) continue;

          const operationMs = extractTimeMs(operation);
          if (operationMs === null) continue;
          if (operationMs < windowFromMs || operationMs > windowToMs) {
            debugMeta.out_of_range_skip_count += 1;
            debugMeta.preflight_enrichment_skip_count += 1;
            continue;
          }

          const key = buildOperationKey(operation, operationMs);
          if (!key) continue;
          if (!operationMap.has(key)) {
            operationMap.set(key, operation);
          }

          oldestSeenMs = Math.min(oldestSeenMs, operationMs);
          newestSeenMs = Math.max(newestSeenMs, operationMs);
        }

        const rangeProgress = 20 + Math.round(((index + 1) / Math.max(1, ranges.length)) * 20);
        reportProgress("parse_fetching_ranges", rangeProgress, operationMap.size);
      }

      if (operationMap.size === 0) {
        throw new Error("No operations returned by API");
      }

      const sortedOperations = Array.from(operationMap.values()).sort((left, right) => {
        const leftMs = extractTimeMs(left) ?? 0;
        const rightMs = extractTimeMs(right) ?? 0;
        return rightMs - leftMs;
      });
      const existingTransactionStates = await lookupExistingTransactionStates(sortedOperations);

      const receiptState = {
        hasRequestedReceipt: false,
        sharedRetriesRemaining: receiptMaxSharedRetries,
        stoppedAfterBudget: false,
        requestStartedAtMs: [] as number[],
      };
      const detailStageStartedAtMs = Date.now();
      const estimatedReceiptRequestCount = sortedOperations.reduce((count, operation, index) => {
        const existingState =
          existingTransactionStates[index] && typeof existingTransactionStates[index] === "object"
            ? (existingTransactionStates[index] as Record<string, unknown>)
            : null;
        if (existingState?.fulfilled === true) return count;
        return count + (operationHasShoppingReceipt(operation) ? 1 : 0);
      }, 0);
      const estimatedFullModeDetailMs =
        receiptParseStrategy === "full"
          ? estimateReceiptEnrichmentMs(estimatedReceiptRequestCount)
          : null;
      const buildTimingEstimatePayload = (): Record<string, unknown> => {
        if (receiptParseStrategy !== "full" || estimatedFullModeDetailMs === null) {
          return {};
        }
        return {
          estimated_total_ms: estimatedFullModeDetailMs,
          estimated_remaining_ms: Math.max(
            0,
            estimatedFullModeDetailMs - (Date.now() - detailStageStartedAtMs),
          ),
          estimate_updated_at: new Date().toISOString(),
          estimated_receipt_request_count: estimatedReceiptRequestCount,
        };
      };
      let receiptQueue = Promise.resolve<{
        shoppingReceipt: JsonMap | null;
        shoppingReceiptMeta: ShoppingReceiptEnrichmentMeta;
      } | null>(null);
      const scheduleShoppingReceipt = (
        operation: JsonMap,
      ): Promise<{
        shoppingReceipt: JsonMap | null;
        shoppingReceiptMeta: ShoppingReceiptEnrichmentMeta;
      }> => {
        const nextReceiptRequest = receiptQueue.then(
          async () =>
            tryFetchShoppingReceipt(
              operation,
              sessionId,
              receiptState,
              debugMeta.receipt_enrichment,
            ),
          async () =>
            tryFetchShoppingReceipt(
              operation,
              sessionId,
              receiptState,
              debugMeta.receipt_enrichment,
            ),
        );
        receiptQueue = nextReceiptRequest.then(
          (value) => value,
          () => null,
        );
        return nextReceiptRequest;
      };

      let completedDetails = 0;
      reportProgress(
        "parse_enriching_operations",
        44,
        sortedOperations.length,
        buildTimingEstimatePayload(),
      );
      const operationRecords = await mapWithConcurrency(
        sortedOperations,
        receiptParseStrategy === "full" ? 2 : 5,
        async (operation, index) => {
          const existingState =
            existingTransactionStates[index] && typeof existingTransactionStates[index] === "object"
              ? (existingTransactionStates[index] as Record<string, unknown>)
              : null;
          const isFulfilled = existingState?.fulfilled === true;
          let operationDetail: JsonMap | null = null;
          let receiptResult: {
            shoppingReceipt: JsonMap | null;
            shoppingReceiptMeta: ShoppingReceiptEnrichmentMeta;
          };
          let trancheOffers: JsonMap | null = null;

          if (isFulfilled) {
            debugMeta.preflight_enrichment_skip_count += 1;
            debugMeta.fulfilled_skip_count += 1;
            receiptResult = {
              shoppingReceipt: null,
              shoppingReceiptMeta: {
                ...buildShoppingReceiptMeta(operation, null),
                receipt_enrichment_status: "not_requested",
                receipt_line_items_skipped: false,
                receipt_retryable: false,
                receipt_retry_attempts: 0,
                receipt_message:
                  "Skipped because transaction already has complete persisted detail.",
                skip_reason: "already_fulfilled",
                expected: operationHasShoppingReceipt(operation),
                requested: false,
              },
            };
          } else {
            [operationDetail, receiptResult, trancheOffers] = await Promise.all([
              tryFetchOperationDetail(operation, detailApiUrl, sessionId),
              scheduleShoppingReceipt(operation),
              tryFetchTrancheOffers(operation, trancheOffersApiUrl, sessionId, trancheBaseParams),
            ]);
          }
          completedDetails += 1;
          reportProgress(
            "parse_enriching_operations",
            44 + Math.round((completedDetails / Math.max(1, sortedOperations.length)) * 10),
            completedDetails,
            buildTimingEstimatePayload(),
          );
          return {
            operation,
            operationDetail,
            shoppingReceipt: receiptResult.shoppingReceipt,
            shoppingReceiptMeta: receiptResult.shoppingReceiptMeta,
            trancheOffers,
          };
        },
      );
      debugMeta.api_operation_count = operationRecords.length;
      debugMeta.first_operation_posted_at =
        newestSeenMs > 0 ? new Date(newestSeenMs).toISOString() : null;
      debugMeta.last_operation_posted_at =
        Number.isFinite(oldestSeenMs) && oldestSeenMs > 0
          ? new Date(oldestSeenMs).toISOString()
          : null;
      debugMeta.stage_timings_ms.api = Date.now() - apiStartedMs;
      debugMeta.stage_timings_ms.total = Date.now() - startedAtMs;

      return {
        method: "api",
        operation_records: operationRecords,
        window_to:
          newestSeenMs > 0 ? new Date(newestSeenMs).toISOString() : new Date().toISOString(),
        parsed_through_at:
          Number.isFinite(oldestSeenMs) && oldestSeenMs > 0
            ? new Date(oldestSeenMs).toISOString()
            : new Date(windowFromMs).toISOString(),
        parsed_transactions_count: operationRecords.length,
        debug: {
          extraction_method: "api",
          fallback_used: false,
          fallback_reason: null,
          blocked_reason: null,
          discovered_endpoints: debugMeta.discovered_endpoints,
          range_attempts: debugMeta.range_attempts,
          range_request_count: debugMeta.range_request_count,
          effective_chunk_span_days: debugMeta.effective_chunk_span_days,
          first_operation_posted_at: debugMeta.first_operation_posted_at,
          last_operation_posted_at: debugMeta.last_operation_posted_at,
          page_originated_operations_request_seen:
            debugMeta.page_originated_operations_request_seen,
          response_status_histogram: debugMeta.response_status_histogram,
          stage_timings_ms: debugMeta.stage_timings_ms,
          api_error_message: null,
          api_operation_count: debugMeta.api_operation_count,
          dom_row_count: 0,
          receipt_enrichment: debugMeta.receipt_enrichment,
          preflight_enrichment_skip_count: debugMeta.preflight_enrichment_skip_count,
          fulfilled_skip_count: debugMeta.fulfilled_skip_count,
          out_of_range_skip_count: debugMeta.out_of_range_skip_count,
        },
      };
    } catch (error) {
      debugMeta.api_error_message =
        error instanceof Error ? error.message : "Unknown API extraction error";
      debugMeta.stage_timings_ms.api = Date.now() - apiStartedMs;
      reportProgress("parse_using_dom_fallback", 46);
      const domStartedMs = Date.now();
      const rows = parseDomFallbackRows(windowFromMs, windowToMs);
      debugMeta.dom_row_count = rows.length;
      reportProgress("parse_dom_rows_ready", 54, rows.length);
      debugMeta.stage_timings_ms.dom = Date.now() - domStartedMs;
      debugMeta.stage_timings_ms.total = Date.now() - startedAtMs;
      return {
        method: "dom",
        rows,
        window_to: rows[0]?.posted_at ? String(rows[0].posted_at) : new Date().toISOString(),
        parsed_through_at: rows[rows.length - 1]?.posted_at
          ? String(rows[rows.length - 1].posted_at)
          : new Date(windowFromMs).toISOString(),
        parsed_transactions_count: rows.length,
        debug: {
          extraction_method: "dom",
          fallback_used: true,
          fallback_reason: debugMeta.api_error_message,
          blocked_reason: null,
          discovered_endpoints: debugMeta.discovered_endpoints,
          range_attempts: debugMeta.range_attempts,
          range_request_count: debugMeta.range_request_count,
          effective_chunk_span_days: debugMeta.effective_chunk_span_days,
          first_operation_posted_at: debugMeta.first_operation_posted_at,
          last_operation_posted_at: debugMeta.last_operation_posted_at,
          page_originated_operations_request_seen:
            debugMeta.page_originated_operations_request_seen,
          response_status_histogram: debugMeta.response_status_histogram,
          stage_timings_ms: debugMeta.stage_timings_ms,
          api_error_message: debugMeta.api_error_message,
          api_operation_count: debugMeta.api_operation_count,
          dom_row_count: debugMeta.dom_row_count,
          receipt_enrichment: debugMeta.receipt_enrichment,
          preflight_enrichment_skip_count: debugMeta.preflight_enrichment_skip_count,
          fulfilled_skip_count: debugMeta.fulfilled_skip_count,
          out_of_range_skip_count: debugMeta.out_of_range_skip_count,
        },
      };
    }
  }

  function detectBlockedReason(): string | null {
    return detectBlockedReasonFromPageState(window.location.href, document.body?.innerText || "");
  }

  function reportProgress(
    phase: string,
    progressPercent: number,
    parsedTransactionsCount?: number | null,
    extraPayload?: Record<string, unknown>,
  ): void {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) return;

    try {
      void runtime.sendMessage({
        type: "MONEY_IMPORT_PROGRESS",
        session_id: progressSessionId,
        phase,
        progress_percent: progressPercent,
        parsed_transactions_count: parsedTransactionsCount ?? null,
        ...(extraPayload ?? {}),
      });
    } catch {
      // Ignore progress transport failures; parsing should still continue.
    }
  }

  function waitMs(delayMs: number): Promise<void> {
    if (delayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  function sendRuntimeMessage<T>(message: Record<string, unknown>): Promise<T | null> {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) return Promise.resolve(null);

    return new Promise((resolve) => {
      try {
        runtime.sendMessage(message, (response: T | null) => {
          resolve(response ?? null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function discoverOperationsApiUrl(): string | null {
    const resources = performance.getEntriesByType("resource");
    const candidates = resources
      .map((entry) => (entry as PerformanceResourceTiming).name)
      .filter((name): name is string => typeof name === "string");
    return findLatestResourceUrlByPath(
      candidates,
      "/api/common/v1/operations",
      window.location.origin,
    );
  }

  function hasPageOriginatedOperationsRequest(): boolean {
    const resources = performance.getEntriesByType("resource");
    return resources.some((entry) => {
      const name = (entry as PerformanceResourceTiming).name;
      if (typeof name !== "string") return false;
      try {
        const parsed = new URL(name, window.location.origin);
        return parsed.pathname === "/api/common/v1/operations";
      } catch {
        return false;
      }
    });
  }

  function discoverOperationDetailApiUrl(): string | null {
    const resources = performance.getEntriesByType("resource");
    const candidates = resources
      .map((entry) => (entry as PerformanceResourceTiming).name)
      .filter((name): name is string => typeof name === "string");
    return findLatestResourceUrlByPath(
      candidates,
      "/api/common/v1/operation",
      window.location.origin,
    );
  }

  function discoverTrancheOffersApiUrl(): string | null {
    const resources = performance.getEntriesByType("resource");
    const candidates = resources
      .map((entry) => (entry as PerformanceResourceTiming).name)
      .filter((name): name is string => typeof name === "string");
    return findLatestResourceUrlByPath(
      candidates,
      "/api/common/v1/tranche_offers",
      window.location.origin,
    );
  }

  function discoverSessionId(url: string | null): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url, window.location.origin);
      return text(parsed.searchParams.get("sessionid"));
    } catch {
      return null;
    }
  }

  function discoverSessionIdFromResources(): string | null {
    const resources = performance.getEntriesByType("resource");
    for (let index = resources.length - 1; index >= 0; index -= 1) {
      const name = (resources[index] as PerformanceResourceTiming).name;
      if (typeof name !== "string") continue;
      const maybeSessionId = discoverSessionId(name);
      if (maybeSessionId) return maybeSessionId;
    }
    return null;
  }

  function buildRanges(
    windowFromMs: number,
    nowMs: number,
    chunkDays = 14,
  ): Array<{ start: number; end: number }> {
    const chunkMs = Math.max(1, chunkDays) * (24 * 60 * 60 * 1000);
    const ranges: Array<{ start: number; end: number }> = [];
    let cursorEnd = Math.max(windowFromMs, nowMs);
    while (cursorEnd >= windowFromMs) {
      const start = Math.max(windowFromMs, cursorEnd - chunkMs + 1);
      ranges.push({ start, end: cursorEnd });
      if (start <= windowFromMs) break;
      cursorEnd = start - 1;
    }
    return ranges;
  }

  function buildRangeUrl(baseUrl: string, start: number, end: number): string {
    const parsed = new URL(baseUrl, window.location.origin);
    parsed.searchParams.set("start", String(start));
    parsed.searchParams.set("end", String(end));
    return parsed.toString();
  }

  function buildOperationKey(operation: JsonMap, operationMs: number): string | null {
    const id = text(operation.id);
    if (id) return `id:${id}`;
    const operationId = text(asObj(operation.operationId)?.value);
    if (operationId) return `operationId:${operationId}`;
    const authId = text(operation.authorizationId);
    if (authId) return `auth:${authId}`;
    const amount =
      toNum(asObj(operation.accountAmount)?.value) ?? toNum(asObj(operation.amount)?.value);
    const description = text(operation.description) || "unknown";
    if (amount === null) return null;
    return `fallback:${operationMs}:${amount}:${description}`;
  }

  function buildExistingTransactionStateCandidate(operation: JsonMap): JsonMap | null {
    const operationMs = extractTimeMs(operation);
    const baseAmount =
      toNum(asObj(operation.accountAmount)?.value) ?? toNum(asObj(operation.amount)?.value);
    if (operationMs === null || baseAmount === null) return null;
    const direction = text(operation.type)?.toLowerCase() ?? "";
    const signedAmount =
      direction.includes("credit") || direction.includes("income")
        ? Math.abs(baseAmount)
        : direction.includes("debit") || direction.includes("expense")
          ? -Math.abs(baseAmount)
          : baseAmount;
    return {
      external_id:
        text(operation.id) ||
        text(asObj(operation.operationId)?.value) ||
        text(operation.authorizationId),
      dedupe_hash: null,
      posted_at: new Date(operationMs).toISOString(),
      amount: signedAmount,
    };
  }

  async function lookupExistingTransactionStates(
    operations: JsonMap[],
  ): Promise<Array<Record<string, unknown> | null>> {
    if (!input.sourceId || !input.payerPersonId || operations.length === 0) {
      return operations.map(() => null);
    }
    const candidates = operations.map((operation) =>
      buildExistingTransactionStateCandidate(operation),
    );
    const response = await sendRuntimeMessage<{
      ok?: boolean;
      states?: Array<Record<string, unknown> | null>;
    }>({
      type: "MONEY_IMPORT_GET_EXISTING_TRANSACTION_STATES",
      source: input.sourceId,
      payer_person_id: input.payerPersonId,
      candidates,
    });
    const states = Array.isArray(response?.states) ? response.states : [];
    return operations.map((_, index) => states[index] ?? null);
  }

  async function tryFetchShoppingReceipt(
    operation: JsonMap,
    sessionId: string | null,
    receiptState: {
      hasRequestedReceipt: boolean;
      sharedRetriesRemaining: number;
      stoppedAfterBudget: boolean;
      requestStartedAtMs: number[];
    },
    receiptDebug: {
      requested_count: number;
      success_count: number;
      rate_limit_response_count: number;
      rate_limited_count: number;
      skipped_after_budget_count: number;
      failed_count: number;
      retry_attempts_total: number;
      stopped_after_budget: boolean;
      parse_strategy: ConnectorParseStrategy;
      retry_strategy: "shared_budget" | "progressive_backoff";
      base_pause_between_receipts_ms: number;
      max_retry_pause_ms: number;
      window_limit?: number;
      window_ms?: number;
      window_cooldown_count?: number;
      window_cooldown_total_ms?: number;
    },
  ): Promise<{
    shoppingReceipt: JsonMap | null;
    shoppingReceiptMeta: ShoppingReceiptEnrichmentMeta;
  }> {
    const hasReceipt = operationHasShoppingReceipt(operation);
    const receiptRequestKey = extractReceiptRequestKey(operation);

    if (!hasReceipt) {
      return {
        shoppingReceipt: null,
        shoppingReceiptMeta: buildShoppingReceiptMeta(operation, null),
      };
    }

    if (!sessionId) {
      return {
        shoppingReceipt: null,
        shoppingReceiptMeta: {
          receipt_request_key: receiptRequestKey,
          receipt_enrichment_status: "error",
          receipt_line_items_skipped: true,
          receipt_retryable: false,
          receipt_retry_attempts: 0,
          receipt_result_code: null,
          receipt_tracking_id: null,
          receipt_message: "Receipt request session is missing.",
          expected: true,
          requested: false,
        },
      };
    }

    if (!receiptRequestKey) {
      return {
        shoppingReceipt: null,
        shoppingReceiptMeta: {
          receipt_request_key: null,
          receipt_enrichment_status: "error",
          receipt_line_items_skipped: true,
          receipt_retryable: false,
          receipt_retry_attempts: 0,
          receipt_result_code: null,
          receipt_tracking_id: null,
          receipt_message: "Receipt request key is missing.",
          expected: true,
          requested: false,
        },
      };
    }

    if (receiptParseStrategy !== "full" && receiptState.stoppedAfterBudget) {
      receiptDebug.skipped_after_budget_count += 1;
      return {
        shoppingReceipt: null,
        shoppingReceiptMeta: {
          receipt_request_key: receiptRequestKey,
          receipt_enrichment_status: "skipped_after_budget",
          receipt_line_items_skipped: true,
          receipt_retryable: true,
          receipt_retry_attempts: 0,
          receipt_result_code: "REQUEST_RATE_LIMIT_EXCEEDED",
          receipt_tracking_id: null,
          receipt_message:
            "Receipt enrichment stopped for this run after shared retry budget was exhausted.",
          expected: true,
          requested: false,
        },
      };
    }

    const url = new URL("https://www.tbank.ru/api/common/v1/shopping_receipt");
    url.searchParams.set("operationId", receiptRequestKey);
    url.searchParams.set("sessionid", sessionId);

    let retryAttempts = 0;
    let lastReceipt: JsonMap | null = null;
    receiptDebug.requested_count += 1;

    async function awaitReceiptWindowCapacity(): Promise<void> {
      if (receiptParseStrategy !== "full") return;

      while (true) {
        const nowMs = Date.now();
        receiptState.requestStartedAtMs = receiptState.requestStartedAtMs.filter(
          (startedAtMs) => nowMs - startedAtMs < receiptFullModeWindowMs,
        );
        if (receiptState.requestStartedAtMs.length < receiptFullModeWindowLimit) {
          return;
        }

        const oldestStartedAtMs = receiptState.requestStartedAtMs[0];
        if (typeof oldestStartedAtMs !== "number") {
          return;
        }

        const pauseMs = Math.max(
          0,
          oldestStartedAtMs + receiptFullModeWindowMs + receiptFullModeWindowBufferMs - nowMs,
        );
        if (pauseMs <= 0) {
          continue;
        }

        receiptDebug.window_cooldown_count = (receiptDebug.window_cooldown_count ?? 0) + 1;
        receiptDebug.window_cooldown_total_ms =
          (receiptDebug.window_cooldown_total_ms ?? 0) + pauseMs;
        await waitMs(pauseMs);
      }
    }

    while (true) {
      if (receiptState.hasRequestedReceipt) {
        await waitMs(receiptBasePauseBetweenRequestsMs);
      }
      if (retryAttempts > 0) {
        receiptDebug.retry_attempts_total += 1;
        await waitMs(computeReceiptRetryPauseMs(retryAttempts));
      }

      await awaitReceiptWindowCapacity();
      receiptState.hasRequestedReceipt = true;
      receiptState.requestStartedAtMs.push(Date.now());
      const response = await fetch(url.toString(), {
        credentials: "include",
      });
      if (!response.ok) {
        receiptDebug.failed_count += 1;
        return {
          shoppingReceipt: null,
          shoppingReceiptMeta: {
            receipt_request_key: receiptRequestKey,
            receipt_enrichment_status: "error",
            receipt_line_items_skipped: true,
            receipt_retryable: false,
            receipt_retry_attempts: retryAttempts,
            receipt_result_code: null,
            receipt_tracking_id: null,
            receipt_message: `Receipt request failed with HTTP ${response.status}.`,
            expected: true,
            requested: true,
          },
        };
      }

      lastReceipt = asObj(await response.json().catch(() => null));
      const resultCode = extractReceiptResultCode(lastReceipt);
      if (hasReceiptItems(lastReceipt)) {
        receiptDebug.success_count += 1;
        return {
          shoppingReceipt: lastReceipt,
          shoppingReceiptMeta: {
            receipt_request_key: receiptRequestKey,
            receipt_enrichment_status: "ok",
            receipt_line_items_skipped: false,
            receipt_retryable: false,
            receipt_retry_attempts: retryAttempts,
            receipt_result_code: resultCode,
            receipt_tracking_id: text(lastReceipt?.trackingId),
            receipt_message: extractReceiptMessage(lastReceipt),
            expected: true,
            requested: true,
          },
        };
      }

      if (resultCode !== "REQUEST_RATE_LIMIT_EXCEEDED") {
        receiptDebug.failed_count += 1;
        return {
          shoppingReceipt: lastReceipt,
          shoppingReceiptMeta: {
            receipt_request_key: receiptRequestKey,
            receipt_enrichment_status: "error",
            receipt_line_items_skipped: true,
            receipt_retryable: false,
            receipt_retry_attempts: retryAttempts,
            receipt_result_code: resultCode,
            receipt_tracking_id: text(lastReceipt?.trackingId),
            receipt_message: extractReceiptMessage(lastReceipt),
            expected: true,
            requested: true,
          },
        };
      }

      receiptDebug.rate_limit_response_count += 1;
      if (receiptParseStrategy === "full") {
        if (retryAttempts < receiptFullModeMaxRetries) {
          retryAttempts += 1;
          continue;
        }
        receiptDebug.rate_limited_count += 1;
        return {
          shoppingReceipt: lastReceipt,
          shoppingReceiptMeta: {
            receipt_request_key: receiptRequestKey,
            receipt_enrichment_status: "rate_limited",
            receipt_line_items_skipped: true,
            receipt_retryable: true,
            receipt_retry_attempts: retryAttempts,
            receipt_result_code: resultCode,
            receipt_tracking_id: text(lastReceipt?.trackingId),
            receipt_message: extractReceiptMessage(lastReceipt),
            expected: true,
            requested: true,
          },
        };
      }

      if (receiptState.sharedRetriesRemaining <= 0) {
        receiptDebug.rate_limited_count += 1;
        receiptState.stoppedAfterBudget = true;
        receiptDebug.stopped_after_budget = true;
        return {
          shoppingReceipt: lastReceipt,
          shoppingReceiptMeta: {
            receipt_request_key: receiptRequestKey,
            receipt_enrichment_status: "rate_limited",
            receipt_line_items_skipped: true,
            receipt_retryable: true,
            receipt_retry_attempts: retryAttempts,
            receipt_result_code: resultCode,
            receipt_tracking_id: text(lastReceipt?.trackingId),
            receipt_message: extractReceiptMessage(lastReceipt),
            expected: true,
            requested: true,
          },
        };
      }

      receiptState.sharedRetriesRemaining -= 1;
      retryAttempts += 1;
    }
  }

  async function tryFetchOperationDetail(
    operation: JsonMap,
    detailApiUrl: string | null,
    sessionId: string | null,
  ): Promise<JsonMap | null> {
    if (!detailApiUrl || !sessionId) return null;

    const operationId =
      text(operation.authorizationId) ||
      text(asObj(operation.operationId)?.value) ||
      text(operation.id);
    if (!operationId) return null;

    let url: URL;
    try {
      url = new URL(detailApiUrl, window.location.origin);
    } catch {
      return null;
    }

    url.searchParams.set("operationId", operationId);
    url.searchParams.set("sessionid", sessionId);
    const response = await fetch(url.toString(), {
      credentials: "include",
    });
    if (!response.ok) return null;

    return asObj(await response.json().catch(() => null));
  }

  function parseTrancheBaseParams(trancheApiUrl: string | null): {
    appName: string;
    appVersion: string;
    origin: string;
    platform: string;
    programType: string;
    wuid: string | null;
  } | null {
    if (!trancheApiUrl) return null;
    try {
      const parsed = new URL(trancheApiUrl, window.location.origin);
      return {
        appName: text(parsed.searchParams.get("appName")) || "supreme",
        appVersion: text(parsed.searchParams.get("appVersion")) || "0.0.1",
        origin: text(parsed.searchParams.get("origin")) || "web,ib5,platform",
        platform: text(parsed.searchParams.get("platform")) || "web",
        programType: text(parsed.searchParams.get("program_type")) || "rpk_kk",
        wuid: text(parsed.searchParams.get("wuid")),
      };
    } catch {
      return null;
    }
  }

  async function tryFetchTrancheOffers(
    operation: JsonMap,
    trancheApiUrl: string | null,
    sessionId: string | null,
    baseParams: {
      appName: string;
      appVersion: string;
      origin: string;
      platform: string;
      programType: string;
      wuid: string | null;
    } | null,
  ): Promise<JsonMap | null> {
    if (!trancheApiUrl || !sessionId || !baseParams) return null;

    const amount =
      toNum(asObj(operation.accountAmount)?.value) ?? toNum(asObj(operation.amount)?.value);
    if (amount === null) return null;

    let url: URL;
    try {
      url = new URL(trancheApiUrl, window.location.origin);
    } catch {
      return null;
    }

    url.searchParams.set("sessionid", sessionId);
    url.searchParams.set("appName", baseParams.appName);
    url.searchParams.set("appVersion", baseParams.appVersion);
    url.searchParams.set("platform", baseParams.platform);
    url.searchParams.set("program_type", baseParams.programType);
    url.searchParams.set("origin", baseParams.origin);
    url.searchParams.set("amount", String(Math.abs(amount)));
    if (baseParams.wuid) {
      url.searchParams.set("wuid", baseParams.wuid);
    }

    const response = await fetch(url.toString(), {
      credentials: "include",
    });
    if (!response.ok) return null;

    return asObj(await response.json().catch(() => null));
  }

  async function mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const size = Math.max(1, Math.floor(concurrency));
    const result = new Array<R>(values.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (true) {
        const current = nextIndex;
        nextIndex += 1;
        if (current >= values.length) return;
        result[current] = await mapper(values[current], current);
      }
    }

    const workers = Array.from({ length: Math.min(size, values.length) }, () => worker());
    await Promise.all(workers);
    return result;
  }

  function parseDomFallbackRows(windowFromMs: number, windowToMs: number): JsonMap[] {
    const rows: JsonMap[] = [];
    const operationNodes = Array.from(
      document.querySelectorAll('[data-qa-type="atom-operations-feed-operation-root"]'),
    );

    for (const node of operationNodes) {
      const title =
        cleanText(
          node.querySelector('[data-qa-type="atom-operations-feed-operation-title"]')?.textContent,
        ) ||
        cleanText(node.querySelector("h3")?.textContent) ||
        cleanText(node.textContent);
      const amountText = cleanText(
        node.querySelector('[data-qa-type="atom-operations-feed-operation-amount"]')?.textContent,
      );
      const amount = parseLocalizedAmount(amountText);
      const timeValue = readNodeTimeMs(node);

      if (!title || amount === null) continue;
      if (timeValue < windowFromMs || timeValue > windowToMs) continue;

      const postedAt = new Date(timeValue).toISOString();
      rows.push({
        account_id: null,
        card_id: null,
        source: "tbank",
        external_id: null,
        posted_at: postedAt,
        amount,
        currency: "RUB",
        transaction_type: amount >= 0 ? "income" : "expense",
        status: "posted",
        merchant_name: title,
        mcc: null,
        comment: null,
        source_comment: null,
        cashback_amount: null,
        cashback_currency: null,
        is_transfer: false,
        transfer_group_id: null,
        raw_payload: {
          connector_source: "tbank_web",
          extraction_method: "dom",
          all_details_captured: false,
          dom_snapshot: cleanText(node.textContent),
        },
        dedupe_hash: `tbw_dom_${hashString(`${postedAt}|${title}|${amount}`)}`,
        line_items: [
          {
            title,
            amount,
            quantity: null,
            unit: null,
            raw_payload: { source: "dom_fallback" },
          },
        ],
      });
    }

    return rows.sort((left, right) => {
      const leftMs = toMs(left.posted_at) ?? 0;
      const rightMs = toMs(right.posted_at) ?? 0;
      return rightMs - leftMs;
    });
  }

  function readNodeTimeMs(node: Element): number {
    const timeElement = node.querySelector("time");
    if (timeElement) {
      const iso = timeElement.getAttribute("datetime");
      const fromDatetime = toMs(iso);
      if (fromDatetime !== null) return fromDatetime;
      const fromText = toMs(cleanText(timeElement.textContent));
      if (fromText !== null) return fromText;
    }
    return Date.now();
  }

  function parseLocalizedAmount(value: string | null): number | null {
    if (!value) return null;
    const sanitized = value
      .replace(/\u2212/g, "-")
      .replace(/[^\d,.\-+]/g, "")
      .trim();
    if (!sanitized) return null;

    let normalized = sanitized;
    if (normalized.includes(",") && !normalized.includes(".")) {
      const comma = normalized.lastIndexOf(",");
      normalized = `${normalized.slice(0, comma).replace(/,/g, "")}.${normalized.slice(comma + 1)}`;
    }
    const parsed = Number(normalized.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function cleanText(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized || null;
  }

  function text(value: unknown): string | null {
    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized || null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  function toNum(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function toMs(value: unknown): number | null {
    const numberValue = toNum(value);
    if (numberValue !== null) return numberValue;
    if (typeof value === "string" && value.trim()) {
      const parsedDate = new Date(value).getTime();
      return Number.isFinite(parsedDate) ? parsedDate : null;
    }
    return null;
  }

  function asObj(value: unknown): JsonMap | null {
    return value && typeof value === "object" ? (value as JsonMap) : null;
  }

  function extractTimeMs(operation: JsonMap): number | null {
    return (
      toMs(asObj(operation.operationTime)?.milliseconds) ||
      toMs(asObj(operation.debitingTime)?.milliseconds) ||
      toMs(operation.operationDateTime)
    );
  }

  function hashString(input: string): string {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}

function isTbankUrl(url: unknown): url is string {
  return typeof url === "string" && /^https:\/\/(?:[\w-]+\.)?tbank\.ru\//i.test(url);
}

function isOperationsPageUrl(url: unknown): boolean {
  if (!isTbankUrl(url)) return false;
  try {
    // The bank redirects to a versioned page beneath this one (`/mybank/operations/v8/` as of
    // 2026-09) and adds a tracking query. Either is the operations page.
    return isPathUnder(new URL(url).pathname, new URL(OPERATIONS_PAGE_URL).pathname);
  } catch {
    return false;
  }
}

async function getTabById(tabId: number): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome.tabs.get !== "function") {
    return null;
  }

  try {
    return (await chrome.tabs.get(tabId)) ?? null;
  } catch {
    return null;
  }
}

async function waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<chrome.tabs.Tab | null> {
  const currentTab = await getTabById(tabId);
  if (currentTab && currentTab.status !== "loading") {
    return currentTab;
  }

  return new Promise((resolve, reject) => {
    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        void getTabById(tabId).then(resolve);
      }
    };

    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Page load timeout"));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function toIsoString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function asObject(value: unknown): JsonMap | null {
  return value && typeof value === "object" ? (value as JsonMap) : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toFiniteMs(value: unknown): number | null {
  const numberValue = toFiniteNumber(value);
  if (numberValue !== null) return numberValue;
  if (typeof value === "string" && value.trim()) {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function normalizeMcc(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/\d{3,4}/);
  return match ? match[0] : null;
}

function extractCardLast4FromOperation(
  operation: JsonMap,
  merchantName: string,
  isTransfer: boolean,
): string | null {
  if (isAccountNativeOperation(operation, merchantName, isTransfer)) return null;

  const candidates = [
    normalizeText(operation.cardNumber),
    normalizeText(asObject(operation.payment)?.cardNumber),
    normalizeText(asObject(operation.card)?.panMasked),
    normalizeText(asObject(operation.card)?.number),
  ];

  const uniqueLast4 = Array.from(
    new Set(
      candidates
        .map((candidate) => extractCardLast4(candidate))
        .filter((candidate): candidate is string => Boolean(candidate)),
    ),
  );

  if (uniqueLast4.length !== 1) return null;
  return uniqueLast4[0];
}

function isAccountNativeOperation(
  operation: JsonMap,
  merchantName: string,
  isTransfer: boolean,
): boolean {
  if (isTransfer) return true;

  const markers = [
    merchantName,
    normalizeText(operation.description),
    normalizeText(operation.merchantKey),
    normalizeText(operation.subcategory),
    normalizeText(operation.group),
    normalizeText(asObject(operation.subgroup)?.name),
    normalizeText(asObject(operation.spendingCategory)?.name),
    normalizeText(asObject(asObject(operation.categoryInfo)?.bankCategory)?.name),
    normalizeText(asObject(asObject(operation.categoryInfo)?.metacategory)?.name),
    normalizeText(asObject(operation.category)?.name),
    normalizeText(asObject(operation.payment)?.providerId),
    normalizeText(asObject(operation.payment)?.providerGroupId),
    normalizeText(asObject(operation.payment)?.paymentType),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase())
    .join(" ");

  if (
    /between own accounts|between my accounts|card to card|p2p|transfer-inner|внутрибанковский перевод|между своими счетами|пополнение по номеру телефона|перевод|переводы/.test(
      markers,
    )
  ) {
    return true;
  }

  if (
    /interest|balance interest|deposit|bonus|correction|cashback payout|проценты|вклад|бонус|коррекц|пополнение вклада|закрытие вклада/.test(
      markers,
    )
  ) {
    return true;
  }

  return false;
}

function extractCardLast4(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return null;

  const hasMaskMarkers = /[\*\u2022xX]/.test(value);
  if (hasMaskMarkers) return digits.slice(-4);
  if (digits.length === 4) return digits;
  if (digits.length >= 12 && digits.length <= 19) return digits.slice(-4);
  return null;
}

function extractOperationTimeMs(operation: JsonMap): number | null {
  return (
    toFiniteMs(asObject(operation.operationTime)?.milliseconds) ??
    toFiniteMs(asObject(operation.debitingTime)?.milliseconds) ??
    toFiniteMs(operation.operationDateTime)
  );
}

function extractOperationAmount(operation: JsonMap): number | null {
  return (
    toFiniteNumber(asObject(operation.accountAmount)?.value) ??
    toFiniteNumber(asObject(operation.amount)?.value)
  );
}

function resolveSignedAmount(operation: JsonMap, amount: number): number {
  const type = normalizeText(operation.type)?.toLowerCase() || "";
  if (type.includes("debit") || type.includes("expense")) {
    return -Math.abs(amount);
  }
  if (type.includes("credit") || type.includes("income")) {
    return Math.abs(amount);
  }
  return amount;
}

function detectTransfer(operation: JsonMap, merchantName: string): boolean {
  const group = normalizeText(operation.group)?.toLowerCase() || "";
  const subgroup = normalizeText(asObject(operation.subgroup)?.name)?.toLowerCase() || "";
  const title = merchantName.toLowerCase();

  if (group.includes("transfer") || subgroup.includes("transfer")) return true;
  if (
    group.includes("\u043f\u0435\u0440\u0435\u0432\u043e\u0434") ||
    subgroup.includes("\u043f\u0435\u0440\u0435\u0432\u043e\u0434")
  ) {
    return true;
  }
  return /between own accounts|between my accounts|card to card|p2p|\u043c\u0435\u0436\u0434\u0443 \u0441\u0432\u043e\u0438\u043c\u0438 \u0441\u0447\u0435\u0442\u0430\u043c\u0438/.test(
    title,
  );
}

function normalizeCurrencyToken(value: unknown): string | null {
  const text = normalizeText(value)?.toUpperCase();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    if (text === "643") return "RUB";
    if (text === "840") return "USD";
    if (text === "978") return "EUR";
    return null;
  }

  const letters = text.match(/[A-Z]{3}/);
  return letters ? letters[0] : null;
}

function extractCurrency(operation: JsonMap): string {
  const accountCurrency = asObject(asObject(operation.accountAmount)?.currency);
  const amountCurrency = asObject(asObject(operation.amount)?.currency);
  return (
    normalizeCurrencyToken(accountCurrency?.strCode) ||
    normalizeCurrencyToken(accountCurrency?.name) ||
    normalizeCurrencyToken(amountCurrency?.strCode) ||
    normalizeCurrencyToken(amountCurrency?.name) ||
    "RUB"
  );
}

function extractCashbackAmount(operation: JsonMap): number | null {
  const fromSummary = toFiniteNumber(asObject(operation.loyaltyBonusSummary)?.amount);
  if (fromSummary !== null) return fromSummary;

  const fromCashbackAmount = toFiniteNumber(asObject(operation.cashbackAmount)?.value);
  if (fromCashbackAmount !== null) return fromCashbackAmount;

  const fromCashback = toFiniteNumber(operation.cashback);
  if (fromCashback !== null) return fromCashback;

  const loyaltyBonus = Array.isArray(operation.loyaltyBonus) ? operation.loyaltyBonus : [];
  let summed = 0;
  let foundAny = false;
  for (const bonusInput of loyaltyBonus) {
    const bonus = asObject(bonusInput);
    const amountValue = toFiniteNumber(asObject(bonus?.amount)?.value);
    if (amountValue === null) continue;
    foundAny = true;
    summed += amountValue;
  }
  return foundAny ? summed : null;
}

function extractCashbackCurrency(operation: JsonMap, cashbackAmount: number | null): string | null {
  if (cashbackAmount === null) return null;

  const cashbackCurrency = asObject(asObject(operation.cashbackAmount)?.currency);
  const loyaltyCurrency = asObject(asObject(operation.loyaltyUnits)?.currency);
  return (
    normalizeCurrencyToken(cashbackCurrency?.strCode) ||
    normalizeCurrencyToken(cashbackCurrency?.name) ||
    normalizeCurrencyToken(cashbackCurrency?.code) ||
    normalizeCurrencyToken(loyaltyCurrency?.strCode) ||
    normalizeCurrencyToken(loyaltyCurrency?.name) ||
    normalizeCurrencyToken(loyaltyCurrency?.code) ||
    extractCurrency(operation)
  );
}

function normalizeStatus(statusInput: unknown): string {
  const text = normalizeText(statusInput)?.toLowerCase() || "";
  if (!text) return "posted";
  if (
    text.includes("pending") ||
    text.includes("processing") ||
    text.includes("hold") ||
    text.includes("wait") ||
    text.includes("new")
  ) {
    return "pending";
  }
  return "posted";
}

function buildLineItemsFromReceipt(
  shoppingReceiptInput: unknown,
  signedTransactionAmount: number,
  fallbackTitle: string,
): JsonMap[] {
  const shoppingReceipt = asObject(shoppingReceiptInput);
  const receipt =
    asObject(asObject(shoppingReceipt?.payload)?.receipt) || asObject(shoppingReceipt?.receipt);
  const rawItems = Array.isArray(receipt?.items) ? receipt.items : [];
  const sign = signedTransactionAmount >= 0 ? 1 : -1;

  const lineItems = rawItems
    .map((itemInput) => {
      const item = asObject(itemInput);
      if (!item) return null;

      const quantity = toFiniteNumber(item.quantity);
      const amount =
        toFiniteNumber(item.sum) ??
        (() => {
          const price = toFiniteNumber(item.price);
          if (price === null) return null;
          return price * (quantity ?? 1);
        })();
      if (amount === null) return null;

      return {
        title: firstNonEmpty(normalizeText(item.name), normalizeText(item.title), fallbackTitle),
        amount: sign * Math.abs(amount),
        quantity,
        unit: firstNonEmpty(normalizeText(item.measureName), normalizeText(item.unit), null),
        raw_payload: item,
      };
    })
    .filter(Boolean) as JsonMap[];

  if (lineItems.length > 0) return lineItems;

  return [
    {
      title: fallbackTitle,
      amount: signedTransactionAmount,
      quantity: null,
      unit: null,
      raw_payload: { source: "fallback" },
    },
  ];
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildDedupeHash(row: JsonMap): string {
  return `tbw_${hashString(
    [
      row.external_id || "",
      row.operation_id || "",
      row.authorization_id || "",
      row.posted_at || "",
      row.amount || "",
      row.merchant_name || "",
      row.account_hint || "",
    ].join("|"),
  )}`;
}
