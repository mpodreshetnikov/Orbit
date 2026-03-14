import { registerConnector } from "./registry.js";
import type { Connector, ConnectorParseInput, ConnectorParseOutput } from "./types.js";

const HISTORY_PAGE_URL = "https://web.alfabank.ru/history/";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 30;
const EXTRACTION_ATTEMPTS = 2;

type JsonMap = Record<string, unknown>;
type ReceiptEnrichmentStatus = "ok" | "not_requested" | "error";
type MapOperationDropReason = "invalid_record" | "invalid_operation" | "missing_time_or_amount";

interface PageOperationRecord {
  operation: JsonMap;
  operationDetail: JsonMap | null;
  receipt: JsonMap | null;
}

interface PageExtraction {
  method: "api";
  blocked_reason?: string;
  operation_records?: PageOperationRecord[];
  window_to: string;
  parsed_through_at: string;
  parsed_transactions_count: number;
  debug?: {
    extraction_method: "api";
    fallback_used: boolean;
    fallback_reason: string | null;
    blocked_reason: string | null;
    discovered_endpoints: {
      operations_api: string | null;
      operation_detail_api: string | null;
      receipt_api: string | null;
    };
    response_status_histogram: Record<string, number>;
    stage_timings_ms: Record<string, number>;
    api_operation_count: number;
    detail_request_count: number;
    receipt_request_count: number;
    first_operation_posted_at: string | null;
    last_operation_posted_at: string | null;
  };
}

interface MapOperationRecordOptions {
  extractionMethod: "api";
}

const connector: Connector = {
  sourceId: "alfa_web",
  displayName: "Alfa Bank Web",
  async parse({ windowFrom, session, debug }: ConnectorParseInput): Promise<ConnectorParseOutput> {
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
    const normalizedWindowFrom =
      toIsoString(windowFrom) || toIsoString(session?.last_imported_at) || fallbackWindowFromIso;

    const activeTab =
      typeof debug?.tab_id === "number"
        ? await chrome.tabs.get(debug.tab_id).catch(() => null)
        : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!activeTab?.id) {
      throw new Error("No active tab. Open Alfa Bank in a tab first.");
    }

    await emitProgress("parse_preparing_tab", 5);
    if (!isAlfaUrl(activeTab.url)) {
      throw new Error(
        "Active tab is not an Alfa Bank page. Open https://web.alfabank.ru/ and try again.",
      );
    }

    await emitProgress("parse_loading_history_page", 10);
    const readyTab = await prepareHistoryTab(activeTab);
    if (typeof readyTab.id !== "number") {
      throw new Error("No active tab. Open Alfa Bank in a tab first.");
    }

    await emitProgress("parse_extracting_page_data", 20);
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

    await emitProgress(
      "parse_mapping_rows",
      70,
      typeof extraction.parsed_transactions_count === "number"
        ? extraction.parsed_transactions_count
        : null,
    );

    const rows = (extraction.operation_records ?? [])
      .map((record) => {
        const mapped = mapOperationRecordToRowWithReason(record, {
          extractionMethod: "api",
        });
        if (!mapped.row && mapped.dropReason) {
          mappingDropCounts[mapped.dropReason] += 1;
        }
        return mapped.row;
      })
      .filter(Boolean) as JsonMap[];

    return {
      rows,
      windowTo: toIsoString(extraction.window_to) || new Date().toISOString(),
      parsedThroughAt: toIsoString(extraction.parsed_through_at) || normalizedWindowFrom,
      parsedTransactionsCount:
        typeof extraction.parsed_transactions_count === "number"
          ? extraction.parsed_transactions_count
          : rows.length,
      debug: summarizeExtractionDiagnostics(extraction, mappingDropCounts, rows.length),
    };
  },
};

registerConnector(connector);

export default connector;

export const __test__ = {
  detectBlockedReasonFromPageState,
  extractOperationsInPage,
  mapOperationRecordToRow,
};

function summarizeExtractionDiagnostics(
  extraction: PageExtraction,
  mappingDropCounts: Record<string, number>,
  mappedRowCount: number,
): NonNullable<ConnectorParseOutput["debug"]> {
  const debug = extraction.debug;
  return {
    extraction_method: debug?.extraction_method ?? extraction.method,
    fallback_used: debug?.fallback_used ?? false,
    fallback_reason: debug?.fallback_reason ?? null,
    blocked_reason: debug?.blocked_reason ?? extraction.blocked_reason ?? null,
    discovered_endpoints: {
      operations_api: sanitizeDebugUrl(debug?.discovered_endpoints.operations_api ?? null),
      operation_detail_api: sanitizeDebugUrl(
        debug?.discovered_endpoints.operation_detail_api ?? null,
      ),
      tranche_offers_api: null,
    },
    range_attempts: [],
    range_request_count: 0,
    effective_chunk_span_days: null,
    first_operation_posted_at: debug?.first_operation_posted_at ?? null,
    last_operation_posted_at: debug?.last_operation_posted_at ?? null,
    page_originated_operations_request_seen: false,
    response_status_histogram: debug?.response_status_histogram ?? {},
    stage_timings_ms: debug?.stage_timings_ms ?? {},
    mapping_drop_counts: mappingDropCounts,
    api_operation_count: debug?.api_operation_count ?? 0,
    mapped_row_count: mappedRowCount,
    rows_without_line_items: 0,
    receipt_enrichment: {
      requested_count: debug?.receipt_request_count ?? 0,
      success_count: 0,
      rate_limit_response_count: 0,
      rate_limited_count: 0,
      skipped_after_budget_count: 0,
      failed_count: 0,
      retry_attempts_total: 0,
      stopped_after_budget: false,
      parse_strategy: "fast",
      retry_strategy: "shared_budget",
      base_pause_between_receipts_ms: 0,
      max_retry_pause_ms: 0,
    },
    preflight_enrichment_skip_count: 0,
    fulfilled_skip_count: 0,
    out_of_range_skip_count: 0,
  };
}

function sanitizeDebugUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function formatDiagnosticError(message: string, details: Record<string, unknown>): Error {
  const normalizedMessage = message.trim();
  const separator = /[.!?]$/.test(normalizedMessage) ? "" : ".";
  return new Error(`${normalizedMessage}${separator} diagnostics=${JSON.stringify(details)}`);
}

function isAlfaUrl(url: unknown): url is string {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "web.alfabank.ru" || hostname.endsWith(".alfabank.ru");
  } catch {
    return false;
  }
}

function isHistoryPageUrl(url: unknown): boolean {
  if (!isAlfaUrl(url)) return false;
  try {
    const pathname = new URL(url).pathname;
    return pathname === "/history" || pathname === "/history/";
  } catch {
    return false;
  }
}

function detectBlockedReasonFromTabUrl(tabUrl: unknown): string | null {
  if (typeof tabUrl !== "string" || !tabUrl.trim()) return null;
  return detectBlockedReasonFromPageState(tabUrl, "");
}

function detectBlockedReasonFromPageState(pageUrl: string, pageText: string): string | null {
  const normalizedUrl = pageUrl.trim().toLowerCase();
  const normalizedText = pageText.slice(0, 6000).toLowerCase();
  const looksLikeLoginUrl =
    normalizedUrl.includes("private.auth.alfabank.ru") ||
    normalizedUrl.includes("/phone_auth") ||
    normalizedUrl.includes("/passport/") ||
    normalizedUrl.includes("/login") ||
    normalizedUrl.includes("/cerberus");

  if (
    looksLikeLoginUrl ||
    /sign in|log in|login/.test(normalizedText) ||
    /\u0432\u043e\u0439\u0442\u0438|\u0432\u043e\u0439\u0434\u0438\u0442\u0435|\u0430\u0432\u0442\u043e\u0440\u0438\u0437/.test(
      normalizedText,
    )
  ) {
    return "Alfa Bank session is not authorized. Sign in and retry import.";
  }

  if (
    /captcha|verify|challenge|too many requests/.test(normalizedText) ||
    /\u043a\u0430\u043f\u0447|\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434/.test(normalizedText)
  ) {
    return "Alfa Bank requested verification. Resolve blocking challenge and retry import.";
  }

  return null;
}

async function prepareHistoryTab(tab: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  if (typeof tab.id !== "number") {
    throw new Error("No active tab. Open Alfa Bank in a tab first.");
  }
  if (!isAlfaUrl(tab.url)) {
    throw new Error(
      "Active tab is not an Alfa Bank page. Open https://web.alfabank.ru/ and try again.",
    );
  }

  const initialBlockedReason = detectBlockedReasonFromTabUrl(tab.url);
  if (initialBlockedReason) {
    throw formatDiagnosticError(initialBlockedReason, {
      tab_url: tab.url ?? null,
      tab_status: tab.status ?? null,
    });
  }

  const tabId = tab.id;
  let currentTab = tab;
  const shouldWaitForLoad = currentTab.status === "loading";

  if (!isHistoryPageUrl(currentTab.url)) {
    await chrome.tabs.update(tabId, { url: HISTORY_PAGE_URL });
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

  if (!isHistoryPageUrl(currentTab.url)) {
    throw formatDiagnosticError("Alfa Bank did not stay on the history page", {
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
      if (extraction) return extraction;

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
  throw formatDiagnosticError("Unable to extract Alfa Bank operations from current page", {
    tab_url: finalTab?.url ?? null,
    tab_status: finalTab?.status ?? null,
    execute_script_attempts: attemptDetails,
  });
}

function extractOperationsInPage(input: { windowFromIso?: string }): Promise<PageExtraction> {
  return run(input);

  async function run(args: { windowFromIso?: string }): Promise<PageExtraction> {
    const startedAtMs = Date.now();
    const normalizedWindowFrom =
      toIsoStringInline(args.windowFromIso) ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const windowFromMs = toMsInline(normalizedWindowFrom) ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
    const origin = String(window.location?.origin || "https://web.alfabank.ru");
    const operationsApiUrl = `${origin}/api/v1/operations-history/operations`;
    const operationDetailApiBaseUrl = `${origin}/api/v1/operations-history/details/../operations/`;
    const receiptApiBaseUrl = `${origin}/api/v1/ofd/receipt/`;
    const debugMeta = {
      discovered_endpoints: {
        operations_api: operationsApiUrl,
        operation_detail_api: `${origin}/api/v1/operations-history/operations/{id}`,
        receipt_api: `${origin}/api/v1/ofd/receipt/{id}`,
      },
      response_status_histogram: {} as Record<string, number>,
      stage_timings_ms: {} as Record<string, number>,
      api_operation_count: 0,
      detail_request_count: 0,
      receipt_request_count: 0,
      first_operation_posted_at: null as string | null,
      last_operation_posted_at: null as string | null,
    };

    const blockedReason = detectBlockedReasonFromPageStateInline(
      String(window.location?.href || ""),
      cleanTextInline(document.body?.innerText) || "",
    );
    if (blockedReason) {
      return buildBlockedExtraction(blockedReason);
    }

    const commonHeaders = buildCommonHeaders();
    const operationRecords: PageOperationRecord[] = [];
    const operations: JsonMap[] = [];
    let page = 1;
    let stopPaging = false;

    while (!stopPaging) {
      const requestBody =
        page === 1
          ? { size: 20, page: 1, forced: true, filters: [] }
          : { size: 20, page, filters: [] };
      const pageResponse = await fetchJson(operationsApiUrl, {
        method: "POST",
        headers: {
          ...commonHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      if (pageResponse.blockedReason) {
        return buildBlockedExtraction(pageResponse.blockedReason);
      }
      if (!pageResponse.ok) {
        throw new Error(
          `Alfa Bank operations API failed with status ${pageResponse.status ?? "unknown"}.`,
        );
      }

      const payload = asObjInline(pageResponse.data);
      const pageOperations = Array.isArray(payload?.operations) ? payload.operations : [];
      if (pageOperations.length === 0) break;

      for (const operationInput of pageOperations) {
        const operation = asObjInline(operationInput);
        const postedAtMs = toMsInline(operation?.dateTime);
        if (!operation || postedAtMs === null) continue;
        if (postedAtMs < windowFromMs) {
          stopPaging = true;
          continue;
        }
        operations.push(operation);
      }

      if (stopPaging) break;
      page += 1;
    }

    debugMeta.api_operation_count = operations.length;
    if (operations.length > 0) {
      debugMeta.first_operation_posted_at = toIsoStringInline(operations[0]?.dateTime);
      debugMeta.last_operation_posted_at = toIsoStringInline(
        operations[operations.length - 1]?.dateTime,
      );
    }

    for (const operation of operations) {
      const operationId = textInline(operation.id);
      let operationDetail: JsonMap | null = null;
      let receipt: JsonMap | null = null;

      if (operationId) {
        debugMeta.detail_request_count += 1;
        const detailResponse = await fetchJson(
          `${operationDetailApiBaseUrl}${encodeURIComponent(operationId)}`,
          {
            method: "GET",
            headers: commonHeaders,
          },
        );
        if (detailResponse.blockedReason) {
          return buildBlockedExtraction(detailResponse.blockedReason);
        }
        if (detailResponse.ok) {
          operationDetail = asObjInline(detailResponse.data);
        }
      }

      const receiptRequestKey = extractReceiptRequestKeyInline(operation);
      if (receiptRequestKey) {
        debugMeta.receipt_request_count += 1;
        const receiptResponse = await fetchJson(
          `${receiptApiBaseUrl}${encodeURIComponent(receiptRequestKey)}`,
          {
            method: "GET",
            headers: commonHeaders,
          },
        );
        if (receiptResponse.blockedReason) {
          return buildBlockedExtraction(receiptResponse.blockedReason);
        }
        if (receiptResponse.ok) {
          receipt = asObjInline(receiptResponse.data);
        }
      }

      operationRecords.push({
        operation,
        operationDetail,
        receipt,
      });
    }

    debugMeta.stage_timings_ms.total = Date.now() - startedAtMs;
    return {
      method: "api",
      operation_records: operationRecords,
      window_to: new Date().toISOString(),
      parsed_through_at: normalizedWindowFrom,
      parsed_transactions_count: operationRecords.length,
      debug: {
        extraction_method: "api",
        fallback_used: false,
        fallback_reason: null,
        blocked_reason: null,
        discovered_endpoints: debugMeta.discovered_endpoints,
        response_status_histogram: debugMeta.response_status_histogram,
        stage_timings_ms: debugMeta.stage_timings_ms,
        api_operation_count: debugMeta.api_operation_count,
        detail_request_count: debugMeta.detail_request_count,
        receipt_request_count: debugMeta.receipt_request_count,
        first_operation_posted_at: debugMeta.first_operation_posted_at,
        last_operation_posted_at: debugMeta.last_operation_posted_at,
      },
    };

    function buildBlockedExtraction(reason: string): PageExtraction {
      debugMeta.stage_timings_ms.total = Date.now() - startedAtMs;
      return {
        method: "api",
        blocked_reason: reason,
        operation_records: [],
        window_to: new Date().toISOString(),
        parsed_through_at: normalizedWindowFrom,
        parsed_transactions_count: 0,
        debug: {
          extraction_method: "api",
          fallback_used: false,
          fallback_reason: null,
          blocked_reason: reason,
          discovered_endpoints: debugMeta.discovered_endpoints,
          response_status_histogram: debugMeta.response_status_histogram,
          stage_timings_ms: debugMeta.stage_timings_ms,
          api_operation_count: 0,
          detail_request_count: debugMeta.detail_request_count,
          receipt_request_count: debugMeta.receipt_request_count,
          first_operation_posted_at: null,
          last_operation_posted_at: null,
        },
      };
    }

    function buildCommonHeaders(): Record<string, string> {
      const xsrfToken = readCookie("XSRF-TOKEN");
      const zoneOffsetCookie = readCookie("zone-offset");
      return {
        "x-xsrf-token": xsrfToken || "",
        "ao-origin-application-id": "newclick-operations-history-ui",
        "zone-offset": formatZoneOffset(zoneOffsetCookie),
        "x-screen-dimension": "desktop",
      };
    }

    async function fetchJson(
      url: string,
      init: {
        method: string;
        headers: Record<string, string>;
        body?: string;
      },
    ): Promise<{
      ok: boolean;
      status: number | null;
      data: unknown;
      blockedReason: string | null;
    }> {
      const response = await fetch(url, init);
      const status = typeof response.status === "number" ? response.status : null;
      const statusKey = String(status ?? "unknown");
      debugMeta.response_status_histogram[statusKey] =
        (debugMeta.response_status_histogram[statusKey] ?? 0) + 1;
      const data = await response.json().catch(() => null);
      return {
        ok: Boolean(response.ok),
        status,
        data,
        blockedReason: detectBlockedReasonFromApiEnvelope(status, data),
      };
    }

    function detectBlockedReasonFromApiEnvelope(
      status: number | null,
      payload: unknown,
    ): string | null {
      const envelope = asObjInline(payload);
      const text = [
        textInline(envelope?.message),
        textInline(envelope?.error),
        textInline(envelope?.errorMessage),
        textInline(envelope?.resultCode),
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();

      if (
        status === 401 ||
        status === 403 ||
        /unauthori|forbidden|auth|session/.test(text) ||
        /\u0430\u0432\u0442\u043e\u0440\u0438\u0437|\u0432\u043e\u0439\u0442\u0438/.test(text)
      ) {
        return "Alfa Bank session is not authorized. Sign in and retry import.";
      }
      if (
        /captcha|verify|challenge|too many requests/.test(text) ||
        /\u043a\u0430\u043f\u0447|\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434/.test(text)
      ) {
        return "Alfa Bank requested verification. Resolve blocking challenge and retry import.";
      }
      return null;
    }

    function detectBlockedReasonFromPageStateInline(
      pageUrl: string,
      pageText: string,
    ): string | null {
      const normalizedUrl = pageUrl.trim().toLowerCase();
      const normalizedText = pageText.slice(0, 6000).toLowerCase();
      const looksLikeLoginUrl =
        normalizedUrl.includes("private.auth.alfabank.ru") ||
        normalizedUrl.includes("/phone_auth") ||
        normalizedUrl.includes("/passport/") ||
        normalizedUrl.includes("/login") ||
        normalizedUrl.includes("/cerberus");

      if (
        looksLikeLoginUrl ||
        /sign in|log in|login/.test(normalizedText) ||
        /\u0432\u043e\u0439\u0442\u0438|\u0432\u043e\u0439\u0434\u0438\u0442\u0435|\u0430\u0432\u0442\u043e\u0440\u0438\u0437/.test(
          normalizedText,
        )
      ) {
        return "Alfa Bank session is not authorized. Sign in and retry import.";
      }
      return null;
    }

    function readCookie(name: string): string | null {
      const cookieString = String(document.cookie || "");
      const cookieParts = cookieString.split(";").map((part) => part.trim());
      const matched = cookieParts.find((part) => part.startsWith(`${name}=`));
      if (!matched) return null;
      const [, value] = matched.split("=", 2);
      if (typeof value !== "string") return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }

    function formatZoneOffset(rawValue: string | null): string {
      const parsed = Number(rawValue ?? "");
      const minutes = Number.isFinite(parsed) ? parsed : new Date().getTimezoneOffset();
      const absoluteMinutes = Math.abs(minutes);
      const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
      const mins = String(absoluteMinutes % 60).padStart(2, "0");
      return `${minutes <= 0 ? "+" : "-"}${hours}:${mins}`;
    }

    function extractReceiptRequestKeyInline(operation: JsonMap): string | null {
      const receipt = asObjInline(operation.receipt);
      return (
        textInline(receipt?.smartVistaFrontReference) ||
        textInline(operation.smartVistaFrontReference)
      );
    }

    function cleanTextInline(value: unknown): string | null {
      if (typeof value !== "string") return null;
      const normalized = value
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return normalized || null;
    }

    function textInline(value: unknown): string | null {
      if (typeof value === "string") return cleanTextInline(value);
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return null;
    }

    function toNumInline(value: unknown): number | null {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }

    function toMsInline(value: unknown): number | null {
      const numeric = toNumInline(value);
      if (numeric !== null) return numeric;
      if (typeof value === "string" && value.trim()) {
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }

    function toIsoStringInline(value: unknown): string | null {
      if (typeof value !== "string" || !value.trim()) return null;
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
    }

    function asObjInline(value: unknown): JsonMap | null {
      return value && typeof value === "object" ? (value as JsonMap) : null;
    }
  }
}

function mapOperationRecordToRow(
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

  const postedAt = toIsoString(operation.dateTime);
  const absoluteAmount = toFiniteNumber(asObject(operation.amount)?.value);
  if (!postedAt || absoluteAmount === null) {
    return { row: null, dropReason: "missing_time_or_amount" };
  }

  const operationDetail = asObject(record.operationDetail);
  const receipt = asObject(record.receipt);
  const merchantName =
    firstNonEmpty(
      normalizeText(operation.title),
      normalizeText(operationDetail?.title),
      "Alfa Bank operation",
    ) ?? "Alfa Bank operation";
  const signedAmount = applyOperationSign(absoluteAmount, operation.direction);
  const cashbackAmount = extractCashbackAmount(operation);
  const cashbackCurrency = extractCashbackCurrency(operation, cashbackAmount);
  const receiptRequestKey = extractReceiptRequestKey(operation);
  const receiptEnrichmentStatus = resolveReceiptEnrichmentStatus(receiptRequestKey, receipt);
  const accountHint = extractAccountHintFromDetail(operationDetail);
  const allDetailsCaptured =
    Boolean(operationDetail) &&
    (receiptEnrichmentStatus === "not_requested" || receiptEnrichmentStatus === "ok");
  const externalId =
    firstNonEmpty(normalizeText(operation.id), normalizeText(operation.operationId), null) ?? null;

  return {
    row: {
      account_id: null,
      card_id: null,
      source: "alfa",
      external_id: externalId,
      posted_at: postedAt,
      amount: signedAmount,
      currency: extractCurrency(operation),
      transaction_type: signedAmount >= 0 ? "income" : "expense",
      status: normalizeStatus(operation.status),
      merchant_name: merchantName,
      mcc: normalizeMcc(operation.mcc ?? extractMccFromDetail(operationDetail)),
      comment: null,
      source_comment: null,
      cashback_amount: cashbackAmount,
      cashback_currency: cashbackCurrency,
      operation_icon_url: extractAbsoluteUrl(operation.logoUrl),
      source_category: extractSourceCategory(operation),
      source_brand: null,
      receipt_request_key: receiptRequestKey,
      receipt_enrichment_status: receiptEnrichmentStatus,
      receipt_line_items_skipped: receiptEnrichmentStatus === "error",
      receipt_retryable: false,
      receipt_retry_attempts: 0,
      receipt_result_code: null,
      receipt_tracking_id: null,
      receipt_message:
        receiptEnrichmentStatus === "error" && receiptRequestKey
          ? "Receipt details were not captured."
          : null,
      is_transfer: false,
      transfer_group_id: null,
      raw_payload: {
        connector_source: "alfa_web",
        extraction_method: options.extractionMethod,
        all_details_captured: allDetailsCaptured,
        account_hint: accountHint,
        operation,
        operation_detail: operationDetail,
        receipt,
      },
      dedupe_hash: buildDedupeHash({
        external_id: externalId,
        posted_at: postedAt,
        amount: signedAmount,
        merchant_name: merchantName,
        account_hint: accountHint,
        operation_id: normalizeText(operation.operationId),
      }),
      line_items: buildLineItemsFromReceipt(receipt, signedAmount, merchantName),
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

function extractSourceCategory(operation: JsonMap): JsonMap | null {
  const category = asObject(operation.category);
  const id = normalizeText(category?.id);
  const name = normalizeText(category?.name);
  if (!id && !name) return null;
  return { id, name };
}

function extractCashbackAmount(operation: JsonMap): number | null {
  return toFiniteNumber(asObject(asObject(operation.loyalty)?.amount)?.value);
}

function extractCashbackCurrency(operation: JsonMap, cashbackAmount: number | null): string | null {
  if (cashbackAmount === null) return null;
  return normalizeCurrencyToken(asObject(asObject(operation.loyalty)?.amount)?.currency) || "RUB";
}

function extractCurrency(operation: JsonMap): string {
  return normalizeCurrencyToken(asObject(operation.amount)?.currency) || "RUB";
}

function normalizeCurrencyToken(value: unknown): string | null {
  const objectValue = asObject(value);
  if (objectValue) {
    return (
      normalizeCurrencyToken(objectValue.strCode) ||
      normalizeCurrencyToken(objectValue.code) ||
      normalizeCurrencyToken(objectValue.name) ||
      normalizeCurrencyToken(objectValue.currency)
    );
  }

  const text = normalizeText(value)?.toUpperCase();
  if (!text) return null;
  if (text === "RUR" || text === "643") return "RUB";
  if (text === "840") return "USD";
  if (text === "978") return "EUR";
  const match = text.match(/[A-Z]{3}/);
  return match ? match[0] : null;
}

function normalizeStatus(value: unknown): string {
  const text = normalizeText(value)?.toUpperCase() ?? "";
  if (text.includes("PENDING") || text.includes("HOLD") || text.includes("WAIT")) {
    return "pending";
  }
  return "posted";
}

function applyOperationSign(amount: number, directionInput: unknown): number {
  const direction = normalizeText(directionInput)?.toUpperCase() ?? "";
  if (direction === "EXPENSE") return -Math.abs(amount);
  return Math.abs(amount);
}

function resolveReceiptEnrichmentStatus(
  receiptRequestKey: string | null,
  receipt: JsonMap | null,
): ReceiptEnrichmentStatus {
  if (!receiptRequestKey) return "not_requested";
  return hasReceiptLineItems(receipt) ? "ok" : "error";
}

function hasReceiptLineItems(receiptInput: unknown): boolean {
  const receipt = asObject(receiptInput);
  const fields = Array.isArray(receipt?.fields) ? receipt.fields : [];
  return fields.some((fieldInput) => {
    const field = asObject(fieldInput);
    const subtitle = normalizeText(field?.subtitle);
    return normalizeText(field?.type)?.toUpperCase() === "DATA_VIEW" && Boolean(subtitle);
  });
}

function extractReceiptRequestKey(operation: JsonMap): string | null {
  const receipt = asObject(operation.receipt);
  return (
    firstNonEmpty(
      normalizeText(receipt?.smartVistaFrontReference),
      normalizeText(operation.smartVistaFrontReference),
      null,
    ) ?? null
  );
}

function buildLineItemsFromReceipt(
  receiptInput: unknown,
  signedTransactionAmount: number,
  fallbackTitle: string,
): JsonMap[] {
  const receipt = asObject(receiptInput);
  const fields = Array.isArray(receipt?.fields) ? receipt.fields : [];
  const sign = signedTransactionAmount >= 0 ? 1 : -1;
  const lineItems = fields
    .map((fieldInput) => {
      const field = asObject(fieldInput);
      const type = normalizeText(field?.type)?.toUpperCase();
      const title = normalizeText(field?.title);
      const subtitle = normalizeText(field?.subtitle);
      const amountMinor = parseLocalizedMoneyToMinor(field?.value);
      if (type !== "DATA_VIEW" || !title || !subtitle || amountMinor === null) return null;
      if (!/[x\u0445\u00d7]/i.test(subtitle)) return null;
      return {
        title,
        amount: sign * Math.abs(amountMinor),
        quantity: extractQuantityFromSubtitle(subtitle),
        unit: null,
        raw_payload: field,
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

function extractQuantityFromSubtitle(value: string): number | null {
  const match = value.match(/[x\u0445\u00d7]\s*([0-9]+(?:[.,][0-9]+)?)\s*$/i);
  if (!match) return null;
  const parsed = Number(match[1]?.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLocalizedMoneyToMinor(value: unknown): number | null {
  const text = normalizeText(value);
  if (!text) return null;
  const sanitized = text.replace(/\u2212/g, "-").replace(/[^\d,.\-]/g, "");
  if (!sanitized) return null;

  let normalized = sanitized;
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  if (decimalIndex >= 0) {
    const integerPart = normalized.slice(0, decimalIndex).replace(/[,.]/g, "");
    const decimalPart = normalized.slice(decimalIndex + 1).replace(/[,.]/g, "");
    normalized = `${integerPart}.${decimalPart}`;
  } else {
    normalized = normalized.replace(/[,.]/g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function extractMccFromDetail(detailInput: unknown): string | null {
  for (const entry of extractDetailFieldEntries(detailInput)) {
    const normalized = normalizeMcc(firstNonEmpty(entry.value, entry.title, entry.subtitle, null));
    if (normalized) return normalized;
  }
  return null;
}

function extractAccountHintFromDetail(detailInput: unknown): string | null {
  for (const entry of extractDetailFieldEntries(detailInput)) {
    const exactValue = normalizeText(entry.value);
    if (exactValue && /^\d{4}$/.test(exactValue)) {
      return exactValue;
    }
  }

  for (const entry of extractDetailFieldEntries(detailInput)) {
    const last4 = extractCardLast4(firstNonEmpty(entry.value, entry.subtitle, entry.title, null));
    if (last4) return last4;
  }
  return null;
}

function extractDetailFieldEntries(detailInput: unknown): Array<{
  title: string | null;
  subtitle: string | null;
  value: string | null;
}> {
  const entries: Array<{ title: string | null; subtitle: string | null; value: string | null }> =
    [];

  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    const objectValue = asObject(value);
    if (!objectValue) return;

    const title = readNestedTextValue(objectValue.title);
    const subtitle = readNestedTextValue(objectValue.subtitle);
    const fieldValue = readNestedTextValue(objectValue.value);
    if (title || subtitle || fieldValue) {
      entries.push({ title, subtitle, value: fieldValue });
    }

    for (const child of Object.values(objectValue)) walk(child);
  }

  walk(asObject(detailInput)?.fields ?? detailInput);
  return entries;
}

function readNestedTextValue(value: unknown): string | null {
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const objectValue = asObject(value);
  if (!objectValue) return null;
  if ("value" in objectValue) return readNestedTextValue(objectValue.value);
  if ("text" in objectValue) return readNestedTextValue(objectValue.text);
  return null;
}

function extractCardLast4(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return null;
  if (digits.length === 4) return digits;
  if (/[*\u2022xX]/.test(value) || digits.length >= 12) {
    return digits.slice(-4);
  }
  return null;
}

function normalizeMcc(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/\d{4}/);
  return match ? match[0] : null;
}

function buildDedupeHash(row: JsonMap): string {
  return `afw_${hashString(
    [
      row.external_id || "",
      row.operation_id || "",
      row.posted_at || "",
      row.amount || "",
      row.merchant_name || "",
      row.account_hint || "",
    ].join("|"),
  )}`;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function getTabById(tabId: number): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome.tabs.get !== "function") return null;
  try {
    return (await chrome.tabs.get(tabId)) ?? null;
  } catch {
    return null;
  }
}

async function waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<chrome.tabs.Tab | null> {
  const currentTab = await getTabById(tabId);
  if (currentTab && currentTab.status !== "loading") return currentTab;

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
