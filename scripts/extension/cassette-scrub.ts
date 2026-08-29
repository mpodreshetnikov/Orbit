/**
 * Strips a recorded bank cassette of everything that identifies the account it came from.
 *
 * A cassette is captured against a real, signed-in bank session, so the raw recording holds a
 * live `sessionid`, card numbers, account identifiers and the account holder's name. None of
 * that may reach the repository, and a cassette is exactly the kind of file where a
 * credential hides in plain sight — so scrubbing is a required step between recording and
 * committing, not a convenience.
 *
 * Amounts, merchant names and operation timing survive on purpose: those are what the replay
 * and contract tests assert on, and a cassette that lost them would prove nothing.
 */

export const REDACTED = "REDACTED";

/** Field names whose value is an identifier, wherever they appear in a payload. */
const IDENTIFIER_KEYS = new Set([
  "sessionid",
  "sessionId",
  "session_id",
  "cardnumber",
  "cardNumber",
  "card_number",
  "panmasked",
  "panMasked",
  "pan",
  "accountid",
  "accountId",
  "account_id",
  "accountnumber",
  "accountNumber",
  "account_number",
  "externalaccountid",
  "externalAccountId",
  "agreementnumber",
  "agreementNumber",
  "contractnumber",
  "contractNumber",
  "clientid",
  "clientId",
  "client_id",
  "authorization",
  "Authorization",
  "set-cookie",
  "Set-Cookie",
  "cookie",
  "Cookie",
]);

/** Field names holding a person's name rather than a merchant's. */
const PERSON_NAME_KEYS = new Set([
  "clientname",
  "clientName",
  "firstname",
  "firstName",
  "lastname",
  "lastName",
  "middlename",
  "middleName",
  "fullname",
  "fullName",
  "ownername",
  "ownerName",
  "cardholder",
  "cardHolder",
  "cardholdername",
  "cardHolderName",
]);

const SENSITIVE_QUERY_PARAMS = new Set([
  "sessionid",
  "sessionId",
  "session_id",
  "token",
  "access_token",
  "auth",
]);

/** Any run of 13+ digits is a card or account number, wherever it turns up in free text. */
const LONG_DIGIT_RUN = /\d{13,}/g;

/**
 * Epoch milliseconds are a thirteen-digit run too, and they are the one thing a cassette must
 * keep: the connector reads operation timing out of `operationTime.milliseconds` and
 * `debitingTime.milliseconds`, and Milestone 4's acceptance turns on the contract test failing
 * when that timing is removed. So the leak scan has to tell a timestamp from an account number
 * rather than flagging every long run — otherwise the first genuine recording turns the commit
 * gate red, and the only way to green is deleting the data the cassette exists to carry.
 *
 * The exemption is by field, not by value. Judging on value alone would clear any thirteen-digit
 * number that happens to read as a date before 2100 — and an account number like 4000000000006
 * does, so an unknown field carrying one would pass the scan silently. Only the three fields
 * below are exempt, each because blanking it breaks the cassette rather than protecting anyone.
 *
 * A real payload that carries its timing under some other key will therefore be reported rather
 * than passed. That is the safe direction to be wrong in: the recorder refuses to hand over the
 * file and says which run it could not place, instead of shipping an identifier.
 */
const EXEMPT_STRUCTURAL_VALUES = [
  /"milliseconds"\s*:\s*(\d{13})(?!\d)/g,
  // Range bounds are epoch milliseconds too, and they are the only record of which window a
  // recorded response answered.
  /[?&](?:start|end)=(\d{13})(?!\d)/g,
  // The operation id is what `createCassettePlayer` keys a receipt by. A numeric one blanked
  // here would merge every receipt in the cassette into one entry — the replay would then
  // answer each request with the first receipt and look like it worked. It is a bank-generated
  // reference, not a card or account number.
  /[?&]operationId=(\d{13,})/gi,
] as const;

function exemptStructuralSpans(serialized: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const pattern of EXEMPT_STRUCTURAL_VALUES) {
    for (const match of serialized.matchAll(pattern)) {
      const digits = match[1];
      if (match.index === undefined || digits === undefined) continue;
      const start = match.index + match[0].length - digits.length;
      spans.push([start, start + digits.length]);
    }
  }
  return spans;
}

/**
 * Query parameters whose value the replay matches on, or which record the window a response
 * answered. Running the free-text digit scrub over these does more harm than the digits could:
 * `operationId` blanked merges every receipt into one entry, and `start`/`end` blanked leave a
 * cassette nobody can read back. Sensitive parameters are still redacted by name above.
 */
const STRUCTURAL_QUERY_PARAMS = new Set(["start", "end", "operationid"]);

export function scrubUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return scrubFreeText(rawUrl);
  }

  for (const name of Array.from(url.searchParams.keys())) {
    const lowered = name.toLowerCase();
    if (SENSITIVE_QUERY_PARAMS.has(name) || SENSITIVE_QUERY_PARAMS.has(lowered)) {
      url.searchParams.set(name, REDACTED);
      continue;
    }
    if (STRUCTURAL_QUERY_PARAMS.has(lowered)) continue;
    const value = url.searchParams.get(name);
    if (value !== null) url.searchParams.set(name, scrubFreeText(value));
  }
  return `${scrubFreeText(`${url.origin}${url.pathname}`)}${url.search}${url.hash}`;
}

export function scrubFreeText(value: string): string {
  return value
    .replace(/([?&](?:sessionid|session_id|token|access_token|auth)=)[^&#\s"']+/gi, `$1${REDACTED}`)
    .replace(LONG_DIGIT_RUN, REDACTED);
}

function isIdentifierKey(key: string): boolean {
  return IDENTIFIER_KEYS.has(key) || IDENTIFIER_KEYS.has(key.toLowerCase());
}

function isPersonNameKey(key: string): boolean {
  return PERSON_NAME_KEYS.has(key) || PERSON_NAME_KEYS.has(key.toLowerCase());
}

/**
 * Walks a recorded payload and redacts every identifier and personal name it can name, plus
 * any long digit run left in free text. Structure, amounts and merchant text are untouched.
 */
export function scrubCassetteValue(value: unknown): unknown {
  if (typeof value === "string") return scrubFreeText(value);
  if (Array.isArray(value)) return value.map((entry) => scrubCassetteValue(entry));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isIdentifierKey(key) || isPersonNameKey(key)) {
        result[key] = entry === null ? null : REDACTED;
        continue;
      }
      if (key === "url" && typeof entry === "string") {
        result[key] = scrubUrl(entry);
        continue;
      }
      result[key] = scrubCassetteValue(entry);
    }
    return result;
  }
  return value;
}

export interface CassetteEntry {
  url: string;
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export function scrubCassetteEntry(entry: CassetteEntry): CassetteEntry {
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(entry.headers ?? {})) {
    headers[name] = isIdentifierKey(name) ? REDACTED : scrubFreeText(headerValue);
  }

  return {
    url: scrubUrl(entry.url),
    status: entry.status,
    body: scrubCassetteValue(entry.body),
    headers,
  };
}

export function scrubCassette(entries: CassetteEntry[]): CassetteEntry[] {
  return entries.map((entry) => scrubCassetteEntry(entry));
}

/**
 * Keys whose value is a reference the bank generated for an operation, not a way to move money.
 *
 * T-Bank's operation identifiers are sixteen-digit numbers, so a scan that calls every long run
 * an account number reports one per receipt and blocks the recording — which is what the first
 * real recording did, twenty-five times over. None of these is a card or account number, and
 * the fields that are (`cardNumber`, `pan`, `accountId`, `accountNumber`, `agreementNumber`,
 * `contractNumber`) are redacted by name before this scan ever runs.
 *
 * `id` is deliberately absent: it is too generic to clear sight unseen, so a long run under it
 * is still reported — with the key named, so the next person can decide rather than guess.
 */
const REFERENCE_KEYS = new Set([
  "operationid",
  "authorizationid",
  "receiptrequestkey",
  "receiptid",
  "documentid",
  "paymentid",
  "trackingid",
  "ucid",
  "subgroupid",
  "groupid",
]);

/**
 * The JSON key a match sits under, so a report says where the run is rather than only what it
 * is. "long digit run: 7384440901188332" cannot be acted on; naming the field it came from can.
 */
function enclosingKey(serialized: string, index: number): string | null {
  let cursor = index;
  // Two steps, because the bank wraps identifiers as `{"operationId":{"value":"…"}}` and the
  // immediate key there is `value`, which names nothing. One step out reaches the real field.
  for (let depth = 0; depth < 2; depth += 1) {
    const from = Math.max(0, cursor - 256);
    const before = serialized.slice(from, cursor);
    const keyEnd = before.lastIndexOf('":');
    if (keyEnd === -1) return null;
    const keyStart = before.lastIndexOf('"', keyEnd - 1);
    if (keyStart === -1) return null;
    const key = before.slice(keyStart + 1, keyEnd);
    if (key.includes('"')) return null;
    if (key !== "value") return key;
    cursor = from + keyStart;
  }
  return "value";
}

/**
 * Finds anything in a scrubbed cassette that still looks like a secret. Used as a last check
 * before a cassette is committed, on the principle that the scrubber knowing about a field is
 * not the same as the field being gone.
 */
export function findCassetteLeaks(serialized: string): string[] {
  const leaks: string[] = [];

  const sessionMatches = serialized.match(/sessionid=([^&"'\s,}]+)/gi) ?? [];
  for (const match of sessionMatches) {
    if (!match.toLowerCase().endsWith(`=${REDACTED.toLowerCase()}`)) {
      leaks.push(`unredacted session id: ${match}`);
    }
  }

  const exempt = exemptStructuralSpans(serialized);
  const reported = new Set<string>();
  for (const match of serialized.matchAll(LONG_DIGIT_RUN)) {
    const start = match.index;
    if (start === undefined) continue;
    if (exempt.some(([from, to]) => start === from && start + match[0].length === to)) continue;

    const key = enclosingKey(serialized, start);
    if (key && REFERENCE_KEYS.has(key.toLowerCase())) continue;

    // The same identifier usually repeats across a recording; reporting it once per occurrence
    // buries the distinct problems under twenty copies of one of them.
    const leak = key ? `long digit run under "${key}": ${match[0]}` : `long digit run: ${match[0]}`;
    if (reported.has(leak)) continue;
    reported.add(leak);
    leaks.push(leak);
  }

  return leaks;
}
