import { registerConnector } from "./registry.js";
import type { Connector, ConnectorParseInput, ConnectorParseOutput } from "./types.js";

const OPERATIONS_PAGE_URL = "https://www.tbank.ru/mybank/operations/";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 30;
const EXTRACTION_ATTEMPTS = 2;

type JsonMap = Record<string, unknown>;

interface PageOperationRecord {
  operation: JsonMap;
  operationDetail: JsonMap | null;
  shoppingReceipt: JsonMap | null;
  trancheOffers: JsonMap | null;
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
    response_status_histogram: Record<string, number>;
    stage_timings_ms: Record<string, number>;
    api_error_message: string | null;
    api_operation_count: number;
    dom_row_count: number;
  };
}

interface MapOperationRecordOptions {
  extractionMethod: "api" | "dom";
}

type MapOperationDropReason = "invalid_record" | "invalid_operation" | "missing_time_or_amount";

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
  const cashbackAmount = extractCashbackAmount(operation);
  const cashbackCurrency = extractCashbackCurrency(operation, cashbackAmount);
  const mcc = normalizeMcc(
    operation.mccString ?? operation.mcc ?? asObject(asObject(operation.merchant)?.mcc)?.value,
  );
  const accountHint = extractCardLast4FromOperation(operation);
  const isTransfer = detectTransfer(operation, merchantName);
  const transactionType = isTransfer ? "transfer" : signedAmount >= 0 ? "income" : "expense";
  const externalId =
    firstNonEmpty(
      normalizeText(operation.id),
      normalizeText(asObject(operation.operationId)?.value),
      normalizeText(operation.authorizationId),
    ) ?? null;
  const postedAt = new Date(postedAtMs).toISOString();

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
      is_transfer: isTransfer,
      transfer_group_id: null,
      raw_payload: {
        connector_source: "tbank_web",
        extraction_method: options.extractionMethod,
        all_details_captured: true,
        account_hint: accountHint,
        operation,
        operation_detail: operationDetail,
        shopping_receipt: shoppingReceipt,
        tranche_offers: trancheOffers,
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
): NonNullable<ConnectorParseOutput["debug"]> {
  const debug = extraction.debug;
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
    response_status_histogram: debug?.response_status_histogram ?? {},
    stage_timings_ms: debug?.stage_timings_ms ?? {},
    mapping_drop_counts: mappingDropCounts,
    api_operation_count: debug?.api_operation_count ?? 0,
    mapped_row_count: mappedRowCount,
    rows_without_line_items: 0,
  };
}

const connector: Connector = {
  sourceId: "tbank_web",
  displayName: "T-Bank Web",
  async parse({ windowFrom, session, debug }: ConnectorParseInput): Promise<ConnectorParseOutput> {
    const fallbackWindowFromIso = new Date(
      Date.now() - DEFAULT_LOOKBACK_DAYS * DAY_MS,
    ).toISOString();
    const normalizedWindowFrom =
      toIsoString(windowFrom) || toIsoString(session?.last_imported_at) || fallbackWindowFromIso;

    const activeTab =
      typeof debug?.tab_id === "number"
        ? await chrome.tabs.get(debug.tab_id).catch(() => null)
        : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!activeTab?.id) {
      throw new Error("No active tab. Open T-Bank in a tab first.");
    }

    if (!isTbankUrl(activeTab.url)) {
      throw new Error("Active tab is not a T-Bank page. Open https://www.tbank.ru/ and try again.");
    }

    const readyTab = await prepareOperationsTab(activeTab);
    if (typeof readyTab.id !== "number") {
      throw new Error("No active tab. Open T-Bank in a tab first.");
    }
    const extraction = await extractOperationsWithRetry(readyTab.id, normalizedWindowFrom);
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

    const debugSummary = summarizeExtractionDiagnostics(extraction, mappingDropCounts, rows.length);
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
  buildOperationRanges,
  detectBlockedReasonFromApiEnvelope,
  detectBlockedReasonFromPageState,
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
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractOperationsInPage,
        args: [{ windowFromIso }],
      });
      const extraction = injected?.[0]?.result as PageExtraction | undefined;
      if (extraction) {
        return extraction;
      }

      attemptDetails.push({
        attempt,
        result_count: Array.isArray(injected) ? injected.length : 0,
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

function extractOperationsInPage(input: { windowFromIso?: string }): Promise<PageExtraction> {
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

  async function run(args: { windowFromIso?: string }): Promise<PageExtraction> {
    const startedAtMs = Date.now();
    const pageDayMs = 24 * 60 * 60 * 1000;
    const windowFromMs = toMs(args.windowFromIso) ?? Date.now() - 30 * pageDayMs;
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
      response_status_histogram: {} as Record<string, number>,
      stage_timings_ms: {} as Record<string, number>,
      api_error_message: null as string | null,
      api_operation_count: 0,
      dom_row_count: 0,
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
          response_status_histogram: debugMeta.response_status_histogram,
          stage_timings_ms: debugMeta.stage_timings_ms,
          api_error_message: debugMeta.api_error_message,
          api_operation_count: debugMeta.api_operation_count,
          dom_row_count: 0,
        },
      };
    }

    const blockedReason = detectBlockedReason();
    if (blockedReason) {
      return buildBlockedExtraction(blockedReason);
    }

    const apiStartedMs = Date.now();
    try {
      const operationsApiUrl =
        discoverOperationsApiUrl() || "https://www.tbank.ru/api/common/v1/operations";
      const detailApiUrl = discoverOperationDetailApiUrl();
      const trancheOffersApiUrl = discoverTrancheOffersApiUrl();
      debugMeta.discovered_endpoints.operations_api = operationsApiUrl;
      debugMeta.discovered_endpoints.operation_detail_api = detailApiUrl;
      debugMeta.discovered_endpoints.tranche_offers_api = trancheOffersApiUrl;

      const sessionId = discoverSessionId(operationsApiUrl) || discoverSessionIdFromResources();
      const trancheBaseParams = parseTrancheBaseParams(trancheOffersApiUrl);

      const ranges = buildRanges(windowFromMs, Date.now());
      const operationMap = new Map<string, JsonMap>();
      let oldestSeenMs = Number.POSITIVE_INFINITY;
      let newestSeenMs = 0;

      for (const range of ranges) {
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
          if (operationMs === null || operationMs < windowFromMs) continue;

          const key = buildOperationKey(operation, operationMs);
          if (!key) continue;
          if (!operationMap.has(key)) {
            operationMap.set(key, operation);
          }

          oldestSeenMs = Math.min(oldestSeenMs, operationMs);
          newestSeenMs = Math.max(newestSeenMs, operationMs);
        }
      }

      if (operationMap.size === 0) {
        throw new Error("No operations returned by API");
      }

      const sortedOperations = Array.from(operationMap.values()).sort((left, right) => {
        const leftMs = extractTimeMs(left) ?? 0;
        const rightMs = extractTimeMs(right) ?? 0;
        return rightMs - leftMs;
      });

      const operationRecords = await mapWithConcurrency(sortedOperations, 5, async (operation) => {
        const [operationDetail, shoppingReceipt, trancheOffers] = await Promise.all([
          tryFetchOperationDetail(operation, detailApiUrl, sessionId),
          tryFetchShoppingReceipt(operation, sessionId),
          tryFetchTrancheOffers(operation, trancheOffersApiUrl, sessionId, trancheBaseParams),
        ]);
        return {
          operation,
          operationDetail,
          shoppingReceipt,
          trancheOffers,
        };
      });
      debugMeta.api_operation_count = operationRecords.length;
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
          response_status_histogram: debugMeta.response_status_histogram,
          stage_timings_ms: debugMeta.stage_timings_ms,
          api_error_message: null,
          api_operation_count: debugMeta.api_operation_count,
          dom_row_count: 0,
        },
      };
    } catch (error) {
      debugMeta.api_error_message =
        error instanceof Error ? error.message : "Unknown API extraction error";
      debugMeta.stage_timings_ms.api = Date.now() - apiStartedMs;
      const domStartedMs = Date.now();
      const rows = parseDomFallbackRows(windowFromMs);
      debugMeta.dom_row_count = rows.length;
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
          response_status_histogram: debugMeta.response_status_histogram,
          stage_timings_ms: debugMeta.stage_timings_ms,
          api_error_message: debugMeta.api_error_message,
          api_operation_count: debugMeta.api_operation_count,
          dom_row_count: debugMeta.dom_row_count,
        },
      };
    }
  }

  function detectBlockedReason(): string | null {
    return detectBlockedReasonFromPageState(window.location.href, document.body?.innerText || "");
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

  async function tryFetchShoppingReceipt(
    operation: JsonMap,
    sessionId: string | null,
  ): Promise<JsonMap | null> {
    if (!sessionId) return null;

    const documents = Array.isArray(operation.documents) ? operation.documents : [];
    const hasReceipt =
      Boolean(operation.hasShoppingReceipt) ||
      documents.some((documentValue) => String(documentValue).toLowerCase() === "shoppingreceipt");
    if (!hasReceipt) return null;

    const operationId =
      text(operation.authorizationId) ||
      text(asObj(operation.operationId)?.value) ||
      text(operation.id);
    if (!operationId) return null;

    const url = new URL("https://www.tbank.ru/api/common/v1/shopping_receipt");
    url.searchParams.set("operationId", operationId);
    url.searchParams.set("sessionid", sessionId);

    const response = await fetch(url.toString(), {
      credentials: "include",
    });
    if (!response.ok) return null;

    return asObj(await response.json().catch(() => null));
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

  function parseDomFallbackRows(windowFromMs: number): JsonMap[] {
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
      if (timeValue < windowFromMs) continue;

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
    const pathname = new URL(url).pathname;
    return pathname === "/mybank/operations/" || pathname === "/mybank/operations";
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

function extractCardLast4FromOperation(operation: JsonMap): string | null {
  const candidates = [
    normalizeText(operation.cardNumber),
    normalizeText(asObject(operation.card)?.panMasked),
    normalizeText(asObject(operation.card)?.number),
  ];

  for (const candidate of candidates) {
    const last4 = extractCardLast4(candidate);
    if (last4) return last4;
  }
  return null;
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
