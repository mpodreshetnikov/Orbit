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

export function scrubUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return scrubFreeText(rawUrl);
  }

  for (const name of Array.from(url.searchParams.keys())) {
    if (SENSITIVE_QUERY_PARAMS.has(name) || SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())) {
      url.searchParams.set(name, REDACTED);
    }
  }
  return scrubFreeText(url.toString());
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

  const digitMatches = serialized.match(LONG_DIGIT_RUN) ?? [];
  for (const match of digitMatches) {
    leaks.push(`long digit run: ${match}`);
  }

  return leaks;
}
