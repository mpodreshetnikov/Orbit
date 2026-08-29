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

export interface Cassette {
  name: string;
  entries: CassetteEntry[];
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
  const operations: Array<Record<string, unknown>> = [];

  for (const [index, range] of ranges.entries()) {
    const rangeUrl = new URL(operationsApiUrl, deps.origin);
    rangeUrl.searchParams.set("sessionid", sessionId);
    rangeUrl.searchParams.set("start", String(range.start));
    rangeUrl.searchParams.set("end", String(range.end));

    report(`range ${index + 1}/${ranges.length}`);
    const { entry, body } = await recordRequest(deps, rangeUrl.toString());
    entries.push(entry);

    if (entry.status !== 200) {
      warnings.push(`range ${index + 1} answered ${entry.status}`);
      continue;
    }
    operations.push(...extractOperations(body));
  }

  if (operations.length === 0) {
    warnings.push(
      "No operations in the recorded window. A cassette without operations proves nothing — " +
        "widen windowDays or pick an account with spending.",
    );
  }

  const maxReceipts = options.maxReceipts ?? 25;
  const requested = new Set<string>();
  let receipts = 0;

  for (const operation of operations) {
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
    report(`receipt ${receipts}/${Math.min(maxReceipts, operations.length)}`);
    entries.push((await recordRequest(deps, detailUrl.toString())).entry);
    entries.push((await recordRequest(deps, receiptUrl.toString())).entry);
  }

  const scrubbed = scrubCassette(entries);
  const cassette: Cassette = { name: options.name, entries: scrubbed };
  const leaks = findCassetteLeaks(JSON.stringify(cassette));

  return {
    cassette,
    leaks,
    warnings,
    counts: { ranges: ranges.length, operations: operations.length, receipts },
  };
}
