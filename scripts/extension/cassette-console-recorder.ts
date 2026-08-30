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
const TRANCHE_PATH = "/api/common/v1/tranche_offers";
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

/** The connector's own pause between receipt requests (`receiptBasePauseBetweenRequestsMs`). */
const RECEIPT_PAUSE_MS = 300;

/**
 * Details are paced more lightly than receipts. The connector throttles receipts specifically —
 * they are what the bank limits hardest — while details carry no such window, and a real account
 * has hundreds of them: four hundred at the receipt pace is two minutes of waiting for requests
 * nothing is limiting.
 */
const DETAIL_PAUSE_MS = 100;

/** The connector's `DEFAULT_MAX_RECEIPTS_PER_RUN`. */
const CONNECTOR_MAX_RECEIPTS_PER_RUN = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RecorderDeps {
  fetch: typeof fetch;
  /** URLs the page has already requested — `performance.getEntriesByType("resource")` names. */
  resourceUrls: () => string[];
  origin: string;
  now: () => number;
}

export interface RecorderOptions {
  name: string;
  /**
   * How many Moscow calendar months to record, counting the current one — the default, and the
   * reason there is one.
   *
   * A rolling window of days lines up with no month the bank ever shows. Thirty days back from
   * the 29th covers two days of the previous month, so its total is a fragment: comparing it
   * against the bank's figure for that month reports a loss that never happened, and there is
   * no way to tell that from a recording which genuinely lost operations. Snapping to month
   * boundaries makes at least one month in the summary comparable by construction.
   */
  wholeMonths?: number;
  /** A rolling window instead, when the months are not what matters. Overrides `wholeMonths`. */
  windowDays?: number;
  chunkDays?: number;
  /** Receipts are the expensive request; the bank rate-limits them hardest. */
  maxReceipts?: number;
  /** Pause between per-operation requests. Tests set it to zero; nothing else should. */
  pauseMs?: number;
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
  /**
   * Whether the recorded window covers this whole month and the month has ended. Only a
   * complete month can be compared against the bank; a partial one is short by design, and
   * without this flag it looks exactly like a month the recording lost operations from.
   */
  complete: boolean;
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
  /**
   * Reasons this recording cannot serve as a cassette, whatever else is right about it.
   *
   * Separate from `leaks`, which is about what must not leave the browser; these are about what
   * the file cannot do once it has. Both stop the download, for different reasons.
   */
  blockers: string[];
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

/**
 * The connector's page-local `text`, numbers included. Rejecting a numeric `id` or
 * `authorizationId` here would leave the recorder deduplicating by a different fallback key, or
 * with no receipt or detail key at all, while the replay processes the numeric identifier and
 * asks for entries the cassette never recorded.
 */
function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * The page's own resource timeline holds whatever the page loaded, third-party requests
 * included. Matching a candidate on its path alone would accept `https://elsewhere.example` +
 * the bank's path — and every discovered endpoint is later handed the live `sessionid` before
 * being fetched. CORS does not stop the request going out, so the credential would reach that
 * origin. The recorder's whole claim is that the session never leaves the page it came from,
 * which makes the origin check part of the claim rather than a precaution.
 */
function findLatestByPath(urls: string[], pathname: string, origin: string): string | null {
  for (let index = urls.length - 1; index >= 0; index -= 1) {
    const candidate = urls[index];
    if (typeof candidate !== "string") continue;
    try {
      const parsed = new URL(candidate, origin);
      if (parsed.origin === origin && parsed.pathname === pathname) return candidate;
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
      // Same restriction, for a different reason: a `sessionid` on a foreign URL is not this
      // page's session, and taking it would send someone else's token to the bank.
      const parsed = new URL(candidate, origin);
      if (parsed.origin !== origin) continue;
      const found = text(parsed.searchParams.get("sessionid"));
      if (found) return found;
    } catch {
      continue;
    }
  }
  return null;
}

interface TrancheBaseParams {
  appName: string;
  appVersion: string;
  origin: string;
  platform: string;
  programType: string;
  wuid: string | null;
}

/**
 * The connector's `parseTrancheBaseParams`: every optional parameter the discovered URL omits
 * gets a default, and `tryFetchTrancheOffers` then writes all of them onto the request. The
 * replay matches on every query parameter but `sessionid`, `start` and `end`, so a URL recorded
 * with only the parameters the page happened to carry misses on replay — the enrichment is
 * simply absent, and nothing says so.
 */
export function parseTrancheBaseParams(
  trancheApiUrl: string | null,
  origin: string,
): TrancheBaseParams | null {
  if (!trancheApiUrl) return null;
  try {
    const parsed = new URL(trancheApiUrl, origin);
    return {
      appName: text(parsed.searchParams.get("appName")) ?? "supreme",
      appVersion: text(parsed.searchParams.get("appVersion")) ?? "0.0.1",
      origin: text(parsed.searchParams.get("origin")) ?? "web,ib5,platform",
      platform: text(parsed.searchParams.get("platform")) ?? "web",
      programType: text(parsed.searchParams.get("program_type")) ?? "rpk_kk",
      wuid: text(parsed.searchParams.get("wuid")),
    };
  } catch {
    return null;
  }
}

/** The connector's own parameter order and values, so the recorded URL is the requested one. */
export function buildTrancheUrl(
  trancheApiUrl: string,
  origin: string,
  baseParams: TrancheBaseParams,
  sessionId: string,
  amount: number,
): string {
  const url = new URL(trancheApiUrl, origin);
  url.searchParams.set("sessionid", sessionId);
  url.searchParams.set("appName", baseParams.appName);
  url.searchParams.set("appVersion", baseParams.appVersion);
  url.searchParams.set("platform", baseParams.platform);
  url.searchParams.set("program_type", baseParams.programType);
  url.searchParams.set("origin", baseParams.origin);
  url.searchParams.set("amount", String(Math.abs(amount)));
  // The live `wuid` — the connector sends the discovered value, so the request must carry it.
  // What the cassette keeps is decided at the call site, not here.
  if (baseParams.wuid) url.searchParams.set("wuid", baseParams.wuid);
  return url.toString();
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

/**
 * The connector's `detectBlockedReasonFromApiEnvelope`, reduced to what a recording needs.
 *
 * The bank reports a lost session or a verification challenge inside an HTTP 200 envelope. Read
 * as a plain response that is what an empty operations list looks like, so the recorder would
 * warn about having found nothing and hand over a scrubbed, useless cassette. The connector
 * stops with the reason; so does this.
 */
/**
 * `response.ok`, which is what every request site in the connector actually tests. Comparing
 * against 200 made the recorder stricter than the thing it mirrors: a 206 with a whole payload
 * was discarded and its range marked incomplete here, while the connector went on to process
 * those operations and then ask for details and receipts the cassette does not hold.
 */
function isSuccessStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

export function detectBlockedReason(body: unknown): string | null {
  const envelope = asObject(body);
  if (!envelope) return null;
  const details = asObject(envelope.details);
  const resultCode = text(envelope.resultCode)?.toUpperCase() ?? "";
  const errorCode = text(details?.errorCode)?.toUpperCase() ?? "";
  // The connector reads this through `toNum`, so `"401"` is 401 to it. Comparing the raw value
  // against a number made the recorder miss an envelope the connector treats as unauthorized —
  // and a cassette recorded through one replays as a block on the first request.
  const httpStatusCode = finiteNumber(details?.httpStatusCode);
  const message = [text(envelope.errorMessage), text(details?.message), text(details?.errorCode)]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (
    resultCode === "AUTHENTICATION_FAILED" ||
    errorCode === "INSUFFICIENT_PRIVILEGES" ||
    httpStatusCode === 401 ||
    /authentication failed|insufficient privileges|not authorized/.test(message) ||
    /не указан пользователь|пользователь не найден|недостаточно прав/.test(message)
  ) {
    return "the bank session is not authorized — sign in again and re-run";
  }
  if (
    /captcha|verify you are human|too many requests|checking your browser/.test(message) ||
    /капча|подтвердите|слишком много запросов/.test(message)
  ) {
    return "the bank asked for verification — resolve it on the page and re-run";
  }
  return null;
}

/** The bank answers a throttled receipt with HTTP 200 and this code in the payload. */
/**
 * The connector's `hasReceiptItems`: a receipt response only counts as enrichment when it
 * actually carries items. The bank answers some requests with HTTP 200 and an empty or error
 * envelope, and a cassette that counted those would report coverage the replay cannot deliver.
 */
export function hasReceiptItems(body: unknown): boolean {
  const receipt =
    asObject(asObject(asObject(body)?.payload)?.receipt) ?? asObject(asObject(body)?.receipt);
  return Array.isArray(receipt?.items) && receipt.items.length > 0;
}

/**
 * A well-formed envelope that carries an error instead of data.
 *
 * The committed recording's four hundred and one detail responses are every one of them an
 * HTTP 200 `INVALID_REQUEST_DATA`. Why the bank refuses them is not established — a wrong
 * `operationId`, a missing parameter and a retired endpoint all look like this from here. The
 * cassette records the refusal faithfully, but a recording where every detail response is an
 * error proves nothing about detail mapping, and nothing in the file says so.
 */
export function isErrorEnvelope(body: unknown): boolean {
  const envelope = asObject(body);
  const resultCode = text(envelope?.resultCode) ?? text(asObject(envelope?.payload)?.resultCode);
  return resultCode !== null && resultCode.toUpperCase() !== "OK";
}

/**
 * The connector's `extractReceiptResultCode` reads the **top-level** `resultCode` and nothing
 * else. Looking one level deeper as well made this stricter than the thing it mirrors: a
 * `{ payload: { resultCode: … } }` envelope is an ordinary failed receipt to the connector, which
 * asks once and moves on, so a recording holding it replays fine — and blocking the download
 * would throw away a usable cassette. Same level, same verdict.
 */
export function isRateLimited(body: unknown): boolean {
  return text(asObject(body)?.resultCode)?.toUpperCase() === "REQUEST_RATE_LIMIT_EXCEEDED";
}

/**
 * The raw array and the usable entries, separately.
 *
 * The connector measures truncation against `payload.length` *before* it skips anything that is
 * not an object, and only then walks the entries. Filtering first and measuring the remainder
 * makes a response of a hundred entries with one malformed look like ninety-nine to the
 * recorder and like a hundred to the connector — so the connector splits that range and the
 * recorder does not, and the recorded walk is not the replayed one.
 */
function extractOperations(body: unknown): {
  rawCount: number;
  operations: Array<Record<string, unknown>>;
  payloadIsArray: boolean;
} {
  const payload = asObject(body)?.payload;
  if (!Array.isArray(payload)) return { rawCount: 0, operations: [], payloadIsArray: false };
  return {
    rawCount: payload.length,
    payloadIsArray: true,
    operations: payload.filter(
      (entry): entry is Record<string, unknown> => asObject(entry) !== null,
    ),
  };
}

/**
 * Mirrors the connector's `toNum`, numeric strings included. Rejecting `"1787227199000"` here
 * would drop the operation from the summary and from detail and receipt recording, while the
 * connector went on processing it and asking for entries the cassette does not hold.
 */
function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The connector's `toMs`: a number, a numeric string, or a date string. `operationDateTime`
 * arrives as the last of those, and reading it as a number only would drop the operation from
 * the summary and from every enrichment request while the connector went on processing it.
 */
function timestampMs(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric !== null) return numeric;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Same fields and precedence as the connector's `extractTimeMs`. */
export function operationTimestampMs(operation: Record<string, unknown>): number | null {
  return (
    timestampMs(asObject(operation.operationTime)?.milliseconds) ??
    timestampMs(asObject(operation.debitingTime)?.milliseconds) ??
    timestampMs(operation.operationDateTime)
  );
}

function operationAmount(operation: Record<string, unknown>): number | null {
  return (
    finiteNumber(asObject(operation.accountAmount)?.value) ??
    finiteNumber(asObject(operation.amount)?.value)
  );
}

/**
 * Same precedence *and* same normalisation as the connector's `extractCurrency`.
 *
 * Real payloads carry `{ code: 643, name: "RUB", strCode: "643" }`, and the connector maps the
 * numeric code to a letter one. Taking `strCode` at face value would bucket the summary under
 * "643" while the contract test looks for "RUB", and every month would report as missing.
 */
function normalizeCurrencyToken(value: unknown): string | null {
  const token = text(value)?.toUpperCase();
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    if (token === "643") return "RUB";
    if (token === "840") return "USD";
    if (token === "978") return "EUR";
    return null;
  }
  const letters = token.match(/[A-Z]{3}/);
  return letters ? letters[0] : null;
}

function operationCurrency(operation: Record<string, unknown>): string {
  const account = asObject(asObject(operation.accountAmount)?.currency);
  const amount = asObject(asObject(operation.amount)?.currency);
  return (
    normalizeCurrencyToken(account?.strCode) ??
    normalizeCurrencyToken(account?.name) ??
    normalizeCurrencyToken(amount?.strCode) ??
    normalizeCurrencyToken(amount?.name) ??
    "RUB"
  );
}

/**
 * Same as the connector's `resolveSignedAmount`. T-Bank reports a purchase as `type: "Debit"`
 * with a **positive** `accountAmount.value`, so totalling the raw value counts every purchase
 * as income — the summary would then disagree with the bank on its very first row.
 */
export function resolveSignedAmount(operation: Record<string, unknown>, amount: number): number {
  const type = text(operation.type)?.toLowerCase() ?? "";
  if (type.includes("debit") || type.includes("expense")) return -Math.abs(amount);
  if (type.includes("credit") || type.includes("income")) return Math.abs(amount);
  return amount;
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

/**
 * A refund of a purchase, which the bank subtracts from that month's spending rather than
 * counting as income — and the summary exists to be compared against the bank's own screen.
 *
 * Verified against a real account: the recorded totals exceeded the bank's by the same amount on
 * both sides, 5575.00 in one month and 4068.00 in the next, and each was exactly the two
 * `PAY`/`Credit` operations in that month. Subtracting them brought all four totals onto the
 * bank's own figures to within a rouble — the bank displays whole roubles, and the differences
 * land in [0, 1) where truncation would put them. Without this the comparison never lines up at
 * all, and every reconciliation needs the same correction done by hand.
 */
export function isPurchaseRefund(operation: Record<string, unknown>, amount: number): boolean {
  return amount > 0 && text(operation.group)?.toUpperCase() === "PAY";
}

function moscowMonth(timestampMs: number): string {
  return new Date(timestampMs + MOSCOW_OFFSET_MS).toISOString().slice(0, 7);
}

/** Start of the Moscow calendar month `monthsBack` months before the one holding `timestampMs`. */
export function moscowMonthStartMs(timestampMs: number, monthsBack: number): number {
  const moscow = new Date(timestampMs + MOSCOW_OFFSET_MS);
  return Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth() - monthsBack, 1) - MOSCOW_OFFSET_MS;
}

function monthIsFullyCovered(month: string, windowFromMs: number, windowToMs: number): boolean {
  const [year, monthIndex] = month.split("-").map(Number);
  if (year === undefined || monthIndex === undefined) return false;
  const startMs = Date.UTC(year, monthIndex - 1, 1) - MOSCOW_OFFSET_MS;
  const endMs = Date.UTC(year, monthIndex, 1) - MOSCOW_OFFSET_MS - 1;
  return windowFromMs <= startMs && endMs <= windowToMs;
}

/**
 * A month is comparable against the bank only if the window covers it end to end *and* nothing
 * inside it went unread — neither a day still capped after splitting nor a range the bank
 * answered with an error.
 *
 * The window bounds alone are not enough. A single day that is still at the page limit after
 * splitting is a day this recording is short on, and it can sit in the middle of a month the
 * window covers completely. Marked `complete`, the console then tells the operator that row is
 * safe to compare against the bank — and the contract test goes on asserting totals already
 * known to omit operations, which makes a real regression indistinguishable from the gap.
 */
function monthIsComparable(
  month: string,
  window: { fromMs: number; toMs: number },
  incompleteMs: number[],
): boolean {
  if (!monthIsFullyCovered(month, window.fromMs, window.toMs)) return false;
  return !incompleteMs.some((timestampMs) => moscowMonth(timestampMs) === month);
}

export function summariseOperations(
  operations: Array<Record<string, unknown>>,
  truncationSuspected: number,
  truncationUnresolved: number,
  window: { fromMs: number; toMs: number },
  incompleteMs: number[] = [],
): CassetteSummary {
  const buckets = new Map<string, { income: number; expense: number; operations: number }>();

  for (const operation of operations) {
    const timestampMs = operationTimestampMs(operation);
    const rawAmount = operationAmount(operation);
    if (timestampMs === null || rawAmount === null) continue;
    const amount = resolveSignedAmount(operation, rawAmount);

    const key = `${moscowMonth(timestampMs)}|${operationCurrency(operation)}`;
    const bucket = buckets.get(key) ?? { income: 0, expense: 0, operations: 0 };
    bucket.operations += 1;
    if (isPurchaseRefund(operation, amount)) bucket.expense -= amount;
    else if (amount >= 0) bucket.income += amount;
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
        complete: monthIsComparable(month, window, incompleteMs),
      };
    })
    .sort((left, right) =>
      left.month === right.month
        ? left.currency.localeCompare(right.currency)
        : right.month.localeCompare(left.month),
    );

  return { months, truncationSuspected, truncationUnresolved };
}

/**
 * `storedUrl` exists for the one parameter that must be sent live and must not be kept: `wuid`.
 * Redacting it before the fetch would change the request the bank sees — an endpoint that
 * validates or routes by it answers differently, and the cassette would then record a response
 * the connector never receives.
 */
async function recordRequest(
  deps: RecorderDeps,
  url: string,
  storedUrl = url,
): Promise<{ entry: CassetteEntry; body: unknown }> {
  const response = await deps.fetch(url, { credentials: "include" });
  const body = await response.json().catch(() => null);
  return { entry: { url: storedUrl, status: response.status, body }, body };
}

export async function recordCassette(
  options: RecorderOptions,
  deps: RecorderDeps,
): Promise<RecordingResult> {
  const report = options.onProgress ?? (() => {});
  const warnings: string[] = [];
  const urls = deps.resourceUrls();

  // The connector reads the session out of the operations URL it discovered and only falls back
  // to the resource timeline. Scanning the timeline first picks up whichever same-origin request
  // happened to be newest, which can carry a stale session — and the recorder would then walk
  // ranges the connector would have made with the valid one.
  const operationsCandidate = findLatestByPath(urls, OPERATIONS_PATH, deps.origin);
  const sessionId =
    (operationsCandidate ? discoverSessionId([operationsCandidate], deps.origin) : null) ??
    discoverSessionId(urls, deps.origin);
  if (!sessionId) {
    throw new Error(
      "No session id found in this page's requests. Open the operations page, let the list " +
        "load, then run the recorder again.",
    );
  }

  const operationsApiUrl =
    findLatestByPath(urls, OPERATIONS_PATH, deps.origin) ?? `${deps.origin}${OPERATIONS_PATH}`;
  // Neither of these is defaulted, because the connector does not default them: both come from
  // `findLatestResourceUrlByPath`, which returns null when the page never loaded that endpoint,
  // and the connector then skips that enrichment entirely. Inventing a URL here would record a
  // request the replay never makes — and one per operation, at that, against a live session.
  const detailApiUrl = findLatestByPath(urls, OPERATION_DETAIL_PATH, deps.origin);
  const trancheApiUrl = findLatestByPath(urls, TRANCHE_PATH, deps.origin);
  const trancheBaseParams = parseTrancheBaseParams(trancheApiUrl, deps.origin);

  const nowMs = deps.now();
  // Whole months by default: a rolling day window lines up with no month the bank ever shows,
  // so its totals cannot be compared against one. Two months back means the previous month is
  // covered end to end and can be reconciled exactly, with the current month along for whatever
  // of it has happened.
  const windowFromMs =
    options.windowDays === undefined
      ? moscowMonthStartMs(nowMs, Math.max(0, (options.wholeMonths ?? 2) - 1))
      : nowMs - options.windowDays * DAY_MS;
  const ranges = buildRanges(windowFromMs, nowMs, options.chunkDays ?? CONNECTOR_CHUNK_DAYS);

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
  // Every range this recording could not read in full: a day still at the page limit after
  // splitting, or a range the bank answered with an error. Either one makes the months it
  // touches incomparable, for the same reason — the recording is short there and nothing in the
  // totals would show it.
  const incompleteStartsMs: number[] = [];

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

    if (!isSuccessStatus(entry.status)) {
      // A whole range the bank did not answer. Warned about, but a warning is read once and the
      // summary is read every time it is compared against the bank — so this has to reach the
      // month as well, exactly like a day that stayed capped. Without it the console can tell
      // the operator that a month is safe to compare while an entire range of it is missing.
      warnings.push(`range request ${requestCount} answered ${entry.status}`);
      incompleteStartsMs.push(range.start, range.end);
      continue;
    }

    const blocked = detectBlockedReason(body);
    if (blocked) {
      throw new Error(
        `Recording stopped: ${blocked}. Nothing was downloaded — a cassette recorded through a ` +
          "blocked session holds error envelopes, not operations.",
      );
    }

    const { rawCount, operations: payload, payloadIsArray } = extractOperations(body);

    // A 200 is not the same thing as an answer. The bank returns one for a general error
    // envelope — `INVALID_REQUEST_DATA` is the shape the detail endpoint answers with all day —
    // and a body that is not JSON at all arrives here as a string. Neither carries a `payload`
    // array, and an absent array is indistinguishable from a range that genuinely held no
    // operations. Left alone, such a range is recorded as empty, its month keeps `complete`,
    // and the reconciliation compares a total missing everything that range held: the one
    // failure the month-comparison exists to make impossible. `detectBlockedReason` above does
    // not catch these — it looks for the auth and captcha shapes, which stop the whole
    // recording. This is the milder case, so it gets the same treatment as a non-200: warn, and
    // take the month out of the comparison.
    if (!payloadIsArray || isErrorEnvelope(body)) {
      // The code the bank gave, when it gave one — `INVALID_REQUEST_DATA` names the problem and
      // "no payload array" does not. An error envelope usually omits the array as well, so
      // reading the payload shape first would bury every code behind the same generic line.
      const resultCode = text(asObject(body)?.resultCode);
      const reason =
        resultCode && resultCode.toUpperCase() !== "OK" ? resultCode : "no payload array";
      warnings.push(`range request ${requestCount} answered 200 with ${reason}`);
      incompleteStartsMs.push(range.start, range.end);
      continue;
    }

    let oldestInResponseMs: number | null = null;
    for (const operation of payload) {
      const timestampMs = operationTimestampMs(operation);
      // The connector drops an operation with no readable time, and one older than the window
      // even when the bank volunteers it. Keeping either here would put operations in the
      // summary and spend receipt budget on rows the replay will never process.
      if (timestampMs === null) continue;
      oldestInResponseMs =
        oldestInResponseMs === null ? timestampMs : Math.min(oldestInResponseMs, timestampMs);
      if (timestampMs < windowFromMs) continue;

      const key = buildOperationKey(operation, timestampMs);
      if (key && !operationsByKey.has(key)) operationsByKey.set(key, operation);
    }

    // The two signatures the connector uses: a response at the page limit, or one nearly full
    // whose oldest operation still sits well inside the range — what a cap applied from the
    // newer end looks like.
    const rangeSpanMs = range.end - range.start + 1;
    // Raw, as the connector measures it: `attempt.payload_count = payload.length` before any
    // entry is skipped.
    const hitPageLimit = rawCount >= SUSPECTED_PAGE_LIMIT;
    const nearlyFull = rawCount >= Math.floor(SUSPECTED_PAGE_LIMIT * 0.9);
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
    // Both endpoints, like the failed and error-envelope branches above. A leaf range is at most
    // a day, but a day can straddle a Moscow month boundary — and recording only the start marks
    // the earlier month incomplete while leaving the later one eligible for reconciliation with
    // part of its range unread.
    incompleteStartsMs.push(range.start, range.end);
    warnings.push(
      `A single day (${new Date(range.start).toISOString().slice(0, 10)}) came back at the page ` +
        "limit and cannot be split further — that day is incomplete in this recording, and the " +
        "connector reports the same window as partial.",
    );
  }

  const operations = Array.from(operationsByKey.values());

  const noOperations = operations.length === 0;
  if (noOperations) {
    warnings.push(
      "No operations in the recorded window. A cassette without operations proves nothing — " +
        "widen windowDays or pick an account with spending.",
    );
  }

  const maxReceipts = options.maxReceipts ?? CONNECTOR_MAX_RECEIPTS_PER_RUN;
  const pauseMs = options.pauseMs ?? RECEIPT_PAUSE_MS;
  const detailPauseMs = options.pauseMs ?? DETAIL_PAUSE_MS;
  let receipts = 0;
  let issuedReceiptRequests = 0;

  const receiptBearing = operations.filter(operationHasShoppingReceipt);
  if (operations.length > 0 && receiptBearing.length === 0) {
    warnings.push(
      "No operation in the recorded window carries a receipt, so the cassette exercises the " +
        "range walk but not receipt enrichment. Widen the window or pick a month with shopping.",
    );
  }
  // Only worth saying when the budget is below the connector's own. At or above it the replay
  // stops at the same point for the same reason and marks the rest `skipped_after_budget`, so a
  // window holding more receipts than the budget is ordinary rather than a gap in the cassette.
  // The connector's budget is fixed at 50 and it is not a preference. Recording fewer receipts
  // than it will ask for leaves the replay with misses; recording more leaves entries nothing
  // asks for, and the contract test rejects both. So the only usable value is the connector's.
  //
  // Compared as counts rather than as budgets, because the two budgets only matter through the
  // number of receipts each actually produces. Reasoning about the budgets directly left a hole
  // between them: 51 against 60 receipt-bearing operations took the "recorded fewer than
  // available" branch, which then asked whether 51 was below 50 and concluded there was no
  // problem — while the recorder went on to store 51 entries for the 50 the connector asks for.
  const recordedReceipts = Math.min(maxReceipts, receiptBearing.length);
  const connectorReceipts = Math.min(CONNECTOR_MAX_RECEIPTS_PER_RUN, receiptBearing.length);
  const budgetMismatch = recordedReceipts !== connectorReceipts;

  let detailCount = 0;
  let usableDetails = 0;
  let rateLimited = 0;
  let failedReceipts = 0;
  // The connector orders operations newest-first before it spends the receipt budget, so when a
  // window holds more receipt-bearing operations than the budget allows, *which* fifty it asks
  // for is decided by that order. Recording in response order would record a different fifty,
  // and the replay would miss every one of them while the cassette looked full.
  const enrichmentOrder = [...operations].sort(
    (left, right) => (operationTimestampMs(right) ?? 0) - (operationTimestampMs(left) ?? 0),
  );
  // One pass per distinct operation, with no second deduplication by request key.
  //
  // Adjacent ranges overlap and the bank repeats an operation across them, but `operationsByKey`
  // has already collapsed those: `operations` holds each operation once. Deduplicating again by
  // request key looks like the same guard and is not — two *different* operations can share an
  // `authorizationId`, and the connector enriches each of them separately because it keys by
  // `buildOperationKey`. The committed recording has exactly one such pair, and it recorded one
  // detail response where the replay asks for two.
  for (const operation of enrichmentOrder) {
    const requestKey = extractReceiptRequestKey(operation);

    // The connector asks for the detail of every operation it has not already fulfilled; only
    // the receipt request is conditional. Recording details for receipt-bearing operations
    // alone would leave the replay without an answer for every other one.
    if (detailApiUrl && requestKey !== null) {
      const detailUrl = new URL(detailApiUrl, deps.origin);
      detailUrl.searchParams.set("operationId", requestKey);
      detailUrl.searchParams.set("sessionid", sessionId);

      if (detailCount > 0) await sleep(detailPauseMs);
      detailCount += 1;
      report(`detail ${detailCount}/${operations.length}`);
      const recordedDetail = await recordRequest(deps, detailUrl.toString());
      entries.push(recordedDetail.entry);
      if (isSuccessStatus(recordedDetail.entry.status) && !isErrorEnvelope(recordedDetail.body)) {
        usableDetails += 1;
      }
    }

    // The connector asks for tranche offers for every operation too, whenever the page has
    // loaded that endpoint. A cassette without them replays as one miss per operation.
    //
    // Deliberately outside the receipt-key check above: `tryFetchTrancheOffers` needs only an
    // amount, and `buildOperationKey` keeps an operation that has none of the three identifiers
    // through its timestamp/amount fallback. Gating this on a key the tranche request does not
    // use would lose that operation's tranche entry and miss on replay.
    if (trancheApiUrl && trancheBaseParams) {
      const amount = operationAmount(operation);
      if (amount !== null) {
        await sleep(pauseMs);
        // `wuid` identifies the browser session the recording was made from, and `scrubUrl`
        // would not catch an alphanumeric value. Sent live, kept redacted — which means a
        // tranche entry replays as a miss until the player ignores this parameter the way it
        // ignores `sessionid` (T-260829-h66). A loud test failure beats an identifier on disk.
        const trancheUrl = buildTrancheUrl(
          trancheApiUrl,
          deps.origin,
          trancheBaseParams,
          sessionId,
          amount,
        );
        const storedTrancheUrl = trancheBaseParams.wuid
          ? buildTrancheUrl(
              trancheApiUrl,
              deps.origin,
              { ...trancheBaseParams, wuid: "REDACTED" },
              sessionId,
              amount,
            )
          : trancheUrl;
        entries.push((await recordRequest(deps, trancheUrl, storedTrancheUrl)).entry);
      }
    }

    if (requestKey === null) continue;
    if (!operationHasShoppingReceipt(operation)) continue;
    // Above the connector's budget the recording is already known to be blocked, so every receipt
    // from here is a live request against the bank's rate limit for a file nobody can use. Below
    // it, the requests are fewer than a real run would make and an operator diagnosing a window
    // may well want them, so those still go out — the blocker stops the download either way.
    if (budgetMismatch && recordedReceipts > connectorReceipts) continue;
    // The budget counts requests issued, not receipts captured — as the connector's
    // `issuedReceiptRequestCount` does. Counting successes would let a run that keeps failing
    // issue requests without limit, which is exactly the run the bank is rate-limiting.
    if (issuedReceiptRequests >= maxReceipts) continue;
    issuedReceiptRequests += 1;

    const receiptUrl = new URL(`${deps.origin}${RECEIPT_PATH}`);
    receiptUrl.searchParams.set("operationId", requestKey);
    receiptUrl.searchParams.set("sessionid", sessionId);

    await sleep(pauseMs);
    report(`receipt ${issuedReceiptRequests}/${Math.min(maxReceipts, receiptBearing.length)}`);
    const recorded = await recordRequest(deps, receiptUrl.toString());
    entries.push(recorded.entry);

    // A rate-limited receipt comes back as a successful HTTP envelope carrying an error code.
    // Counting it as captured would overstate what the cassette holds, and on replay the
    // connector retries and gets the same error back — enrichment it can never reproduce.
    if (isRateLimited(recorded.body)) {
      rateLimited += 1;
      continue;
    }
    // A gateway timeout, any other non-200, and an HTTP 200 carrying no receipt items are all
    // error bodies rather than receipts — the connector counts a success only when
    // `hasReceiptItems` holds. Counting them would claim enrichment the cassette cannot replay:
    // the connector retries and gets the same body back. A real recording hit exactly one 504.
    if (!isSuccessStatus(recorded.entry.status) || !hasReceiptItems(recorded.body)) {
      failedReceipts += 1;
      continue;
    }
    receipts += 1;
  }

  if (failedReceipts > 0) {
    warnings.push(
      `${failedReceipts} receipt request(s) came back without a receipt — a non-200 status or ` +
        "an empty envelope. Those entries are error bodies, not receipts; re-record if the " +
        "cassette needs them.",
    );
  }

  if (detailCount > 0 && usableDetails === 0) {
    warnings.push(
      `All ${detailCount} operation detail response(s) came back as errors, so this cassette ` +
        "exercises the range walk and the receipts but not one field that detail enrichment " +
        "supplies. That is faithful — the connector sends the same request and gets the same " +
        "answer — but it means a detail-mapping regression cannot be caught by replaying this " +
        "recording, and it is worth finding out why the bank rejects the request.",
    );
  }

  if (!detailApiUrl) {
    warnings.push(
      "This page had not loaded the operation detail endpoint, so no detail responses were " +
        "recorded. The connector skips that enrichment under the same condition, so the " +
        "cassette is consistent — but open one operation before recording if you want it.",
    );
  }

  const blockers: string[] = [];
  if (noOperations) {
    // The contract test needs at least one mapped operation and the replay throws on an empty
    // operation map, so this cassette cannot pass the suite it exists for. Whether the window is
    // genuinely empty or every range failed, handing the file over only defers finding out.
    blockers.push(
      "No operations were recorded, so this cassette cannot replay: the contract test needs at " +
        "least one mapped operation. Pick a window with activity, or check whether the range " +
        "requests came back empty because the session had expired.",
    );
  }

  if (budgetMismatch) {
    blockers.push(
      `${receiptBearing.length} operations carry a receipt, so this run records ` +
        `${recordedReceipts} of them where the connector asks for ${connectorReceipts} ` +
        `(its budget is fixed at ${CONNECTOR_MAX_RECEIPTS_PER_RUN}, and maxReceipts here is ` +
        `${maxReceipts}). Record fewer and the replay asks for receipts this cassette does not ` +
        "hold; record more and the cassette holds receipts the replay never asks for. Record " +
        "again without setting maxReceipts.",
    );
  }

  if ((options.chunkDays ?? CONNECTOR_CHUNK_DAYS) !== CONNECTOR_CHUNK_DAYS) {
    // `buildRanges` decides how many range requests there are and where their bounds fall, and
    // the replay compares both against the recording. The connector always uses its own span, so
    // any other value produces a cassette whose walk cannot be reproduced — and a smaller one
    // spends extra requests on the live bank to get there.
    blockers.push(
      `chunkDays was set to ${options.chunkDays}, and the connector always walks in ` +
        `${CONNECTOR_CHUNK_DAYS}-day ranges. The recorded range sequence cannot be reproduced on ` +
        "replay. Record again without setting chunkDays.",
    );
  }

  if (rateLimited > 0) {
    // Not a warning. On a throttled receipt the connector retries — twice in fast mode, more in
    // full — so it issues up to three requests where this recording holds one, and the contract
    // test's request count cannot match. A cassette that fails the acceptance path it exists to
    // serve is not a weaker cassette, it is not one; and mirroring the retries here would mean
    // hammering an endpoint that has just said no.
    blockers.push(
      `${rateLimited} receipt request(s) came back rate-limited by the bank. Those are error ` +
        "responses, not receipts, and the connector retries each of them — so this recording " +
        "cannot replay. Wait a few minutes and record again, or raise pauseMs.",
    );
  }

  const scrubbed = scrubCassette(entries);
  const cassette: Cassette = {
    name: options.name,
    entries: scrubbed,
    // Totals are derived before scrubbing but hold nothing the scrubber removes: a month, a
    // currency, a count and two sums. They are the only part of the file a person can check
    // against the bank without reading JSON.
    summary: summariseOperations(
      operations,
      truncationSuspected,
      truncationUnresolved,
      { fromMs: windowFromMs, toMs: nowMs },
      incompleteStartsMs,
    ),
  };
  const leaks = findCassetteLeaks(JSON.stringify(cassette));

  return {
    cassette,
    leaks,
    blockers,
    warnings,
    counts: { ranges: requestCount, operations: operations.length, receipts },
  };
}
