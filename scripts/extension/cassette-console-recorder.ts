/**
 * Records a T-Bank cassette from inside the bank's own page, so recording needs nothing but a
 * signed-in browser.
 *
 * `playwright-cli-capture-tbank-apis.ts` records the same thing by driving a browser from a
 * checkout, which asks the one person who can sign in to first clone the repository, install
 * node and run a build. That is a poor trade for fifteen minutes of work, and it is the reason
 * no cassette exists yet. This module is the same capture expressed as something that can be
 * pasted into the page's console — `build-cassette-recorder.ts` bundles it into a single
 * paste-ready file.
 *
 * Two properties matter more than convenience:
 *
 * - **Nothing leaves the browser.** The recorder scrubs with `cassette-scrub.ts` — the same
 *   code the committed cassettes are checked against — and refuses to hand back a file that
 *   still trips `findCassetteLeaks`. The live session id never reaches a download, let alone
 *   an agent or CI.
 * - **The recorded URLs are the ones the connector will ask for.** Endpoint discovery, the
 *   range walk and the receipt key are mirrored from `tbank-web.ts`, because
 *   `createCassettePlayer` matches on origin, path and the query parameters other than
 *   `sessionid`, `start` and `end`. A cassette recorded against different URLs would replay as
 *   a wall of misses.
 */

import { findCassetteLeaks, scrubCassette, type CassetteEntry } from "./cassette-scrub";

const OPERATIONS_PATH = "/api/common/v1/operations";
const OPERATION_DETAIL_PATH = "/api/common/v1/operation";
const RECEIPT_PATH = "/api/common/v1/shopping_receipt";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Mirrors the connector's 14-day request window; see `buildRanges` in `tbank-web.ts`. */
export const CONNECTOR_CHUNK_DAYS = 14;

/**
 * Mirrors the connector's truncation constants, and must keep mirroring them.
 *
 * The bank answers one response per range and says nothing about whether more was available,
 * so the connector treats a capped-looking response as a truncated range, halves it and asks
 * again. If the recorder walked plain ranges instead, a dense month would record one truncated
 * response where the connector will make three requests — and because the replay player keys
 * every operations request to the same origin and path, ignoring `start` and `end`, it hands
 * them out in recorded order. A cassette whose request sequence differs from the connector's
 * therefore does not merely miss data: it answers the connector's second request with the
 * first request's body, silently.
 */
const SUSPECTED_PAGE_LIMIT = 100;
const MIN_RANGE_SPAN_MS = DAY_MS;

/** The bank prints and totals in Moscow wall clock, so the reconciliation is bucketed there. */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface RecorderDeps {
  fetch: typeof fetch;
  /** URLs the page has already requested — `performance.getEntriesByType("resource")` names. */
  resourceUrls: () => string[];
  origin: string;
  now: () => number;
}

export interface RecorderOptions {
  name: string;
  /** How far back to record. A dense month is what Milestone 5's acceptance asks for. */
  windowDays?: number;
  chunkDays?: number;
  /** Receipts are the expensive request; the bank rate-limits them hardest. */
  maxReceipts?: number;
  onProgress?: (message: string) => void;
}

export interface MonthTotals {
  /** `YYYY-MM` in Moscow time, matching the months the bank's own screen groups by. */
  month: string;
  operations: number;
  currency: string;
  /** Fixed to two decimals so a comparison against the bank is exact, not float-ish. */
  income: string;
  expense: string;
}

/**
 * What the recording claims it captured, in the terms the bank shows on screen.
 *
 * A cassette can look complete and be short: a truncated range loses its remainder in silence,
 * and nothing inside the recording says so. Totals are the cheapest way to find out — the
 * person who recorded it reads their own month off the bank's page and compares. Once the
 * numbers agree the summary stops being a check and becomes an assertion: the contract test
 * replays the cassette and must reproduce them, so a parser change that starts dropping
 * operations fails instead of quietly reporting less.
 */
export interface CassetteSummary {
  months: MonthTotals[];
  /** Ranges that came back looking capped and were split; the connector will split them too. */
  truncationSuspected: number;
  /** Single days still at the cap — the one case neither the connector nor this can resolve. */
  truncationUnresolved: number;
}

export interface Cassette {
  name: string;
  entries: CassetteEntry[];
  summary?: CassetteSummary;
}

export interface RecordingResult {
  cassette: Cassette;
  /** Non-empty means the recording must be thrown away, not committed. */
  leaks: string[];
  /** Things that did not stop the recording but weaken what it proves. */
  warnings: string[];
  counts: {
    ranges: number;
    operations: number;
    receipts: number;
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function findLatestByPath(urls: string[], pathname: string, origin: string): string | null {
  for (let index = urls.length - 1; index >= 0; index -= 1) {
    const candidate = urls[index];
    if (typeof candidate !== "string") continue;
    try {
      if (new URL(candidate, origin).pathname === pathname) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function discoverSessionId(urls: string[], origin: string): string | null {
  for (let index = urls.length - 1; index >= 0; index -= 1) {
    const candidate = urls[index];
    if (typeof candidate !== "string") continue;
    try {
      const found = text(new URL(candidate, origin).searchParams.get("sessionid"));
      if (found) return found;
    } catch {
      continue;
    }
  }
  return null;
}

/** Same walk as the connector's `buildRanges`, so the recorded ranges are the requested ones. */
export function buildRanges(
  windowFromMs: number,
  nowMs: number,
  chunkDays = CONNECTOR_CHUNK_DAYS,
): Array<{ start: number; end: number }> {
  const chunkMs = Math.max(1, chunkDays) * DAY_MS;
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

/**
 * Same predicate as the connector's `operationHasShoppingReceipt`, and it has to be: the
 * connector returns before requesting a receipt for an operation without one, so recording those
 * would spend a limited, rate-limited budget on requests the replay never makes. A transfer at
 * the top of the newest range would otherwise eat the whole allowance before the first purchase.
 */
export function operationHasShoppingReceipt(operation: Record<string, unknown>): boolean {
  const documents = Array.isArray(operation.documents) ? operation.documents : [];
  return (
    Boolean(operation.hasShoppingReceipt) ||
    documents.some((documentValue) => String(documentValue).toLowerCase() === "shoppingreceipt")
  );
}

/** Same precedence as the connector's `extractReceiptRequestKey`. */
export function extractReceiptRequestKey(operation: Record<string, unknown>): string | null {
  return (
    text(operation.authorizationId) ??
    text(asObject(operation.operationId)?.value) ??
    text(operation.id)
  );
}

function extractOperations(body: unknown): Array<Record<string, unknown>> {
  const payload = asObject(body)?.payload;
  if (!Array.isArray(payload)) return [];
  return payload.filter((entry): entry is Record<string, unknown> => asObject(entry) !== null);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Same fields and precedence as the connector's `extractTimeMs`. */
export function operationTimestampMs(operation: Record<string, unknown>): number | null {
  return (
    finiteNumber(asObject(operation.operationTime)?.milliseconds) ??
    finiteNumber(asObject(operation.debitingTime)?.milliseconds) ??
    finiteNumber(operation.operationDateTime)
  );
}

function operationAmount(operation: Record<string, unknown>): number | null {
  return (
    finiteNumber(asObject(operation.accountAmount)?.value) ??
    finiteNumber(asObject(operation.amount)?.value)
  );
}

/** Same precedence as the connector's `extractCurrency`. */
function operationCurrency(operation: Record<string, unknown>): string {
  const account = asObject(asObject(operation.accountAmount)?.currency);
  const amount = asObject(asObject(operation.amount)?.currency);
  return (
    text(account?.strCode) ??
    text(account?.name) ??
    text(amount?.strCode) ??
    text(amount?.name) ??
    "RUB"
  ).toUpperCase();
}

/** Same precedence as the connector's `buildOperationKey`, so both dedupe identically. */
export function buildOperationKey(
  operation: Record<string, unknown>,
  operationMs: number | null,
): string | null {
  const id = text(operation.id);
  if (id) return `id:${id}`;
  const operationId = text(asObject(operation.operationId)?.value);
  if (operationId) return `operationId:${operationId}`;
  const authorizationId = text(operation.authorizationId);
  if (authorizationId) return `auth:${authorizationId}`;
  const amount = operationAmount(operation);
  if (amount === null) return null;
  const description = text(operation.description) ?? "unknown";
  return `fallback:${operationMs}:${amount}:${description}`;
}

function moscowMonth(timestampMs: number): string {
  return new Date(timestampMs + MOSCOW_OFFSET_MS).toISOString().slice(0, 7);
}

export function summariseOperations(
  operations: Array<Record<string, unknown>>,
  truncationSuspected: number,
  truncationUnresolved: number,
): CassetteSummary {
  const buckets = new Map<string, { income: number; expense: number; operations: number }>();

  for (const operation of operations) {
    const timestampMs = operationTimestampMs(operation);
    const amount = operationAmount(operation);
    if (timestampMs === null || amount === null) continue;

    const key = `${moscowMonth(timestampMs)}|${operationCurrency(operation)}`;
    const bucket = buckets.get(key) ?? { income: 0, expense: 0, operations: 0 };
    bucket.operations += 1;
    if (amount >= 0) bucket.income += amount;
    else bucket.expense += Math.abs(amount);
    buckets.set(key, bucket);
  }

  const months = Array.from(buckets.entries())
    .map(([key, bucket]) => {
      const [month = "", currency = ""] = key.split("|");
      return {
        month,
        currency,
        operations: bucket.operations,
        income: bucket.income.toFixed(2),
        expense: bucket.expense.toFixed(2),
      };
    })
    .sort((left, right) =>
      left.month === right.month
        ? left.currency.localeCompare(right.currency)
        : right.month.localeCompare(left.month),
    );

  return { months, truncationSuspected, truncationUnresolved };
}

async function recordRequest(
  deps: RecorderDeps,
  url: string,
): Promise<{ entry: CassetteEntry; body: unknown }> {
  const response = await deps.fetch(url, { credentials: "include" });
  const body = await response.json().catch(() => null);
  return { entry: { url, status: response.status, body }, body };
}

export async function recordCassette(
  options: RecorderOptions,
  deps: RecorderDeps,
): Promise<RecordingResult> {
  const report = options.onProgress ?? (() => {});
  const warnings: string[] = [];
  const urls = deps.resourceUrls();

  const sessionId = discoverSessionId(urls, deps.origin);
  if (!sessionId) {
    throw new Error(
      "No session id found in this page's requests. Open the operations page, let the list " +
        "load, then run the recorder again.",
    );
  }

  const operationsApiUrl =
    findLatestByPath(urls, OPERATIONS_PATH, deps.origin) ?? `${deps.origin}${OPERATIONS_PATH}`;
  const detailApiUrl =
    findLatestByPath(urls, OPERATION_DETAIL_PATH, deps.origin) ??
    `${deps.origin}${OPERATION_DETAIL_PATH}`;

  const nowMs = deps.now();
  const windowDays = options.windowDays ?? 30;
  const ranges = buildRanges(
    nowMs - windowDays * DAY_MS,
    nowMs,
    options.chunkDays ?? CONNECTOR_CHUNK_DAYS,
  );

  const entries: CassetteEntry[] = [];
  // Keyed exactly as the connector keys them, so a repeat across overlapping ranges counts once
  // here and once there — otherwise the reconciliation totals would double-count.
  const operationsByKey = new Map<string, Record<string, unknown>>();

  // A work queue, not a loop over `ranges`, and `unshift` rather than `push`: this is the
  // connector's own walk. The order requests come out in is what the replay hands back, so it
  // has to be the same order.
  const pending = ranges.slice();
  let requestCount = 0;
  let truncationSuspected = 0;
  let truncationUnresolved = 0;

  while (pending.length > 0) {
    const range = pending.shift();
    if (!range) break;

    const rangeUrl = new URL(operationsApiUrl, deps.origin);
    rangeUrl.searchParams.set("sessionid", sessionId);
    rangeUrl.searchParams.set("start", String(range.start));
    rangeUrl.searchParams.set("end", String(range.end));

    requestCount += 1;
    report(`range request ${requestCount} (${pending.length} queued)`);
    const { entry, body } = await recordRequest(deps, rangeUrl.toString());
    entries.push(entry);

    if (entry.status !== 200) {
      warnings.push(`range request ${requestCount} answered ${entry.status}`);
      continue;
    }

    const payload = extractOperations(body);
    let oldestInResponseMs: number | null = null;
    for (const operation of payload) {
      const timestampMs = operationTimestampMs(operation);
      const key = buildOperationKey(operation, timestampMs);
      if (key && !operationsByKey.has(key)) operationsByKey.set(key, operation);
      if (timestampMs !== null) {
        oldestInResponseMs =
          oldestInResponseMs === null ? timestampMs : Math.min(oldestInResponseMs, timestampMs);
      }
    }

    // The two signatures the connector uses: a response at the page limit, or one nearly full
    // whose oldest operation still sits well inside the range — what a cap applied from the
    // newer end looks like.
    const rangeSpanMs = range.end - range.start + 1;
    const hitPageLimit = payload.length >= SUSPECTED_PAGE_LIMIT;
    const nearlyFull = payload.length >= Math.floor(SUSPECTED_PAGE_LIMIT * 0.9);
    const coverageGap =
      nearlyFull &&
      oldestInResponseMs !== null &&
      oldestInResponseMs - range.start > rangeSpanMs / 2;

    if (!hitPageLimit && !coverageGap) continue;

    truncationSuspected += 1;
    if (rangeSpanMs > MIN_RANGE_SPAN_MS) {
      const midpoint = range.start + Math.floor(rangeSpanMs / 2);
      pending.unshift(
        { start: midpoint, end: range.end },
        { start: range.start, end: midpoint - 1 },
      );
      continue;
    }

    truncationUnresolved += 1;
    warnings.push(
      `A single day (${new Date(range.start).toISOString().slice(0, 10)}) came back at the page ` +
        "limit and cannot be split further — that day is incomplete in this recording, and the " +
        "connector reports the same window as partial.",
    );
  }

  const operations = Array.from(operationsByKey.values());

  if (operations.length === 0) {
    warnings.push(
      "No operations in the recorded window. A cassette without operations proves nothing — " +
        "widen windowDays or pick an account with spending.",
    );
  }

  const maxReceipts = options.maxReceipts ?? 25;
  const requested = new Set<string>();
  let receipts = 0;

  const receiptBearing = operations.filter(operationHasShoppingReceipt);
  if (operations.length > 0 && receiptBearing.length === 0) {
    warnings.push(
      "No operation in the recorded window carries a receipt, so the cassette exercises the " +
        "range walk but not receipt enrichment. Widen windowDays or pick a month with shopping.",
    );
  }

  for (const operation of receiptBearing) {
    if (receipts >= maxReceipts) break;
    const receiptKey = extractReceiptRequestKey(operation);
    if (!receiptKey) continue;
    // Adjacent ranges overlap on their bounds and the bank repeats an operation across them, so
    // without this the recorder spends its receipt budget asking for the same receipt twice —
    // the exact request the bank rate-limits hardest.
    if (requested.has(receiptKey)) continue;
    requested.add(receiptKey);

    const detailUrl = new URL(detailApiUrl, deps.origin);
    detailUrl.searchParams.set("operationId", receiptKey);
    detailUrl.searchParams.set("sessionid", sessionId);

    const receiptUrl = new URL(`${deps.origin}${RECEIPT_PATH}`);
    receiptUrl.searchParams.set("operationId", receiptKey);
    receiptUrl.searchParams.set("sessionid", sessionId);

    receipts += 1;
    report(`receipt ${receipts}/${Math.min(maxReceipts, receiptBearing.length)}`);
    entries.push((await recordRequest(deps, detailUrl.toString())).entry);
    entries.push((await recordRequest(deps, receiptUrl.toString())).entry);
  }

  const scrubbed = scrubCassette(entries);
  const cassette: Cassette = {
    name: options.name,
    entries: scrubbed,
    // Totals are derived before scrubbing but hold nothing the scrubber removes: a month, a
    // currency, a count and two sums. They are the only part of the file a person can check
    // against the bank without reading JSON.
    summary: summariseOperations(operations, truncationSuspected, truncationUnresolved),
  };
  const leaks = findCassetteLeaks(JSON.stringify(cassette));

  return {
    cassette,
    leaks,
    warnings,
    counts: { ranges: requestCount, operations: operations.length, receipts },
  };
}
