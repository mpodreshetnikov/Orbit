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
  // Found by running this scrubber over a real recording rather than by reading: each of these
  // survived it. `bankAccountId` carries the same value as `account` under a name no rule
  // covered, and the sender fields identify the other party to a transfer — or the account
  // holder, when the transfer is their own. All are too short for the long-digit rule.
  "bankaccountid",
  "bankAccountId",
  "bank_account_id",
  "senderagreement",
  "senderAgreement",
  "senderdetails",
  "senderDetails",
  "receiveragreement",
  "receiverAgreement",
  "receiverdetails",
  "receiverDetails",
  "recipientdetails",
  "recipientDetails",
  // A transfer's own fields, ten and twelve characters: the counterparty's bank contract and
  // the recipient's phone number. Both sit under `fieldsValues`, where no digit rule reaches
  // them and no name above covers them.
  "bankcontract",
  "bankContract",
  "pointer",
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
  // The bank's own abbreviated form of the counterparty's name, "Марина М." — abbreviated, but
  // still a real person, and a live recording carried fourteen distinct ones.
  "maskedfio",
  "maskedFIO",
]);

/**
 * Operation groups whose `description` and `subcategory` hold the counterparty's name rather
 * than a merchant's.
 *
 * The bank puts the same text in both fields, and what it means depends entirely on the group:
 * under `PAY` it is "Пятёрочка", under `TRANSFER` it is "Марина М.". Redacting the fields
 * outright would take the merchant names the mapper and the contract test are built on;
 * redacting nothing leaves people's names in a committed fixture. So the group decides, and it
 * sits on the same object.
 *
 * `INCOME` is here too. Its descriptions are the account holder's employer and salary lines
 * where they are not a person's name outright, which is no less identifying.
 */
const COUNTERPARTY_GROUPS = new Set(["TRANSFER", "INCOME"]);

/** The fields those groups fill with a name. */
const COUNTERPARTY_TEXT_KEYS = new Set(["description", "subcategory", "merchantkey"]);

const SENSITIVE_QUERY_PARAMS = new Set([
  "sessionid",
  "sessionId",
  "session_id",
  "token",
  "access_token",
  "auth",
]);

/**
 * Card fields, kept as their last four digits rather than blanked.
 *
 * The importer resolves which of the account holder's cards an operation belongs to from
 * exactly those four digits — `tbank-web.ts` reduces every card candidate to `uniqueLast4`,
 * and `extractAccountHintFromRow` consumes the result. Blanking the field outright therefore
 * removed the one part of it the pipeline uses, and a cassette recorded that way could not
 * exercise account resolution at all. Four digits cannot be charged and are what the bank
 * itself prints on screen.
 */
const CARD_TAIL_KEYS = new Set(["cardnumber", "card_number", "pan", "panmasked", "pan_masked"]);

/**
 * Keys that hold an identifier when they carry a scalar and a container when they do not.
 *
 * Real payloads use `"account":"5351691778"` and `"card":"151542334"` — the account holder's
 * internal references, nine and ten digits, short enough to slip past every digit rule — while
 * elsewhere `card` is an object whose `panMasked` the importer reads. One name, two meanings.
 */
const CONTAINER_OR_IDENTIFIER_KEYS = new Set(["account", "card"]);

/**
 * The merchant's fiscal register fields. Numbers, so the value scrub never touched them, and
 * sixteen digits, so the leak scan reported every one of them and refused the download — which
 * is what the first real recording did, once per receipt. Nothing in the import path reads
 * them, so they are removed rather than exempted.
 */
const FISCAL_KEYS = new Set([
  "fiscaldrivenumber",
  "fiscaldrivenumberstring",
  "fiscaldocumentnumber",
  "fiscalsign",
]);

/** Any run of 13+ digits is a card or account number, wherever it turns up in free text. */
const LONG_DIGIT_RUN = /\d{13,}/g;

/**
 * A Russian mobile number is eleven digits — two short of the long run above, so the digit scrub
 * walks straight past one.
 *
 * A real recording proved the gap costs more than the arithmetic suggests. Thirteen counterparty
 * phone numbers reached a delivered cassette under `pointer`, a transfer field the scrubber did
 * not yet name, and the leak scan called the file clean. Naming the key fixed that recording;
 * this catches the next field nobody has seen yet, which is the whole reason the scan exists
 * separately from the scrubber.
 *
 * The boundaries matter: without them the pattern would bite eleven digits out of the middle of
 * a longer account number and leave the rest, and every fifteen-digit operation id starting
 * with a 7 would be reported as a phone.
 */
const PHONE_NUMBER = /(?<![\d+])\+?[78]\d{10}(?!\d)/g;

/**
 * The bank's masked counterparty name: a given name, a space, one capital and a full stop —
 * "Марина М.", "Maksim P.". Anchored to a complete JSON string value, because the point is to
 * catch a name in a field nobody has named yet without catching "Ave Bistro & Gelato" in the
 * merchant field beside it.
 */
const MASKED_PERSON_NAME = /"([A-ZА-ЯЁ][a-zа-яё]{1,30} [A-ZА-ЯЁ]\.)"/g;

/** The same shape, matched against a complete string rather than inside a serialized payload. */
const WHOLE_MASKED_PERSON_NAME = /^[A-ZА-ЯЁ][a-zа-яё]{1,30} [A-ZА-ЯЁ]\.$/;

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
  // The connector's own fallback when an operation carries no nested time object. Known
  // structural timing, so leaving it unexempt would block a recording of that shape.
  /"operationDateTime"\s*:\s*(\d{13})(?!\d)/g,
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
    .replace(LONG_DIGIT_RUN, REDACTED)
    .replace(PHONE_NUMBER, REDACTED);
}

function isIdentifierKey(key: string): boolean {
  return IDENTIFIER_KEYS.has(key) || IDENTIFIER_KEYS.has(key.toLowerCase());
}

function isPersonNameKey(key: string): boolean {
  return PERSON_NAME_KEYS.has(key) || PERSON_NAME_KEYS.has(key.toLowerCase());
}

function maskCardTail(value: unknown): string {
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 4 ? `****${digits.slice(-4)}` : REDACTED;
}

/**
 * Walks a recorded payload and redacts every identifier and personal name it can name, plus
 * any long digit run left in free text. Structure, amounts and merchant text are untouched.
 *
 * `preserve` carries down the subtree of a key naming the bank's own operation reference. Those
 * are long numeric strings — the captured snapshot holds fifteen-digit ones — so the free-text
 * digit scrub would blank them, and `buildOperationKey` prefers `id`: every affected operation
 * would then collapse to the same `id:REDACTED` on replay. It has to reach one level down
 * because the bank wraps them as `{"operationId":{"value":"…"}}`.
 */
function scrubValue(value: unknown, preserve: boolean): unknown {
  if (typeof value === "string") {
    if (preserve) return value;
    // Whatever field it sits in. The group rule below covers the fields the operations list
    // fills with a counterparty's name, but the same name comes back in the detail response
    // under `merchantKey` and inside `{ "type": "Description", "value": … }`, where no group is
    // in sight — and the next response shape will put it somewhere else again. Anchored to the
    // whole value, so "Ave Bistro & Gelato" in the merchant field beside it is untouched.
    if (WHOLE_MASKED_PERSON_NAME.test(value)) return REDACTED;
    return scrubFreeText(value);
  }
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, preserve));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    // Read before walking: whether `description` holds a merchant or a person is decided by the
    // `group` sitting beside it, so the sibling has to be in hand before the field is reached.
    const group = (value as Record<string, unknown>).group;
    const namesCounterparty =
      typeof group === "string" && COUNTERPARTY_GROUPS.has(group.toUpperCase());

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase();

      if (namesCounterparty && COUNTERPARTY_TEXT_KEYS.has(lowered)) {
        result[key] = entry === null ? null : REDACTED;
        continue;
      }
      if (FISCAL_KEYS.has(lowered)) {
        result[key] = entry === null ? null : REDACTED;
        continue;
      }
      if (CARD_TAIL_KEYS.has(lowered)) {
        result[key] = entry === null ? null : maskCardTail(entry);
        continue;
      }
      if (CONTAINER_OR_IDENTIFIER_KEYS.has(lowered)) {
        const isContainer = entry !== null && typeof entry === "object";
        result[key] = isContainer ? scrubValue(entry, false) : entry === null ? null : REDACTED;
        continue;
      }
      if (isIdentifierKey(key) || isPersonNameKey(key)) {
        result[key] = entry === null ? null : REDACTED;
        continue;
      }
      if (key === "url" && typeof entry === "string") {
        result[key] = scrubUrl(entry);
        continue;
      }
      result[key] = scrubValue(entry, preserve || PRESERVED_REFERENCE_KEYS.has(lowered));
    }
    return result;
  }
  return value;
}

export function scrubCassetteValue(value: unknown): unknown {
  return scrubValue(value, false);
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
 * `id` was deliberately withheld at first — too generic to clear sight unseen — and reported
 * with its key named so someone could decide rather than guess. That decision has now been
 * made on evidence: a live recording reported ten of them, every one a fifteen-digit T-Bank
 * operation id of the form `200000000416948`, matching the shape in the captured snapshot. It
 * is the field `buildOperationKey` prefers, so the replay cannot tell two operations apart
 * without it. Card and account values never reach this decision: they are redacted by their own
 * names first.
 */
const REFERENCE_KEYS = new Set([
  "id",
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
 * The same references, plus `id`, kept out of the value scrub so the replay can still tell two
 * operations apart. `id` is preserved here but still *reported* by the leak scan: keeping a
 * value is not the same as vouching for it, and the account and card fields that could hide
 * behind a generic name are handled by name well before this.
 */
const PRESERVED_REFERENCE_KEYS = new Set([...REFERENCE_KEYS, "id"]);

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

  // The bank's masked-name form — "Марина М.", "Maksim P." — as a whole JSON string value. It
  // is what `maskedFIO`, and a transfer's `description` and `subcategory`, actually contain, and
  // a real recording put fourteen of them in a file the scan had already called clean. Matching
  // the whole value keeps a merchant like "Ave Bistro & Gelato" out of it.
  for (const match of serialized.matchAll(MASKED_PERSON_NAME)) {
    const name = match[1];
    if (name === undefined) continue;
    const leak = `masked person name: ${name}`;
    if (reported.has(leak)) continue;
    reported.add(leak);
    leaks.push(leak);
  }

  for (const match of serialized.matchAll(PHONE_NUMBER)) {
    const start = match.index;
    if (start === undefined) continue;

    // An operation reference is kept deliberately unscrubbed, and one of eleven digits starting
    // with a 7 is not a phone number. Same exemption as the digit run above, for the same
    // reason: a leak the recorder cannot clear blocks a download nobody can unblock.
    const key = enclosingKey(serialized, start);
    if (key && REFERENCE_KEYS.has(key.toLowerCase())) continue;

    const leak = key ? `phone number under "${key}": ${match[0]}` : `phone number: ${match[0]}`;
    if (reported.has(leak)) continue;
    reported.add(leak);
    leaks.push(leak);
  }

  return leaks;
}
