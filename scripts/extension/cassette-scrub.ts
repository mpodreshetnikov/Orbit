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
  // The till and the shop, as the bank numbers them. Only eight digits, so no pattern rule sees
  // them, and nothing in the connector reads either — but they are stable keys for "which
  // terminal in which branch", so against the timestamps and amounts already in the file they
  // rebuild exactly the location trail redacting `retailPlaceAddress` was meant to remove. 138
  // distinct `posId` and 59 distinct `pointOfSaleId` in the recording.
  "posid",
  "posId",
  "pointofsaleid",
  "pointOfSaleId",
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
  // Bank-side correlation references. None is used to match a replayed request, and each ties
  // this file to one payment or one receipt in the bank's records. Too short or too alphanumeric
  // for the digit and UUID rules to reach.
  "paymentid",
  "trackingid",
  "ucid",
  "documentid",
  "receiptid",
  "subgroupid",
  "groupid",
  // Payment correlation identifiers: the link a transfer was made through, the QR code it was
  // scanned from, the subscription it belongs to, the message it arrived with. Each ties this
  // cassette to one payment in the bank's records and in the merchant's, and none is read by
  // anything. Ten- and eleven-digit or thirty-two-character values, so neither the digit rule
  // nor the UUID rule reaches them — the committed recording held thirty-two, eleven, one and
  // one of them respectively.
  "pointerlinkid",
  "qrid",
  "subscriptionid",
  "messageid",
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
  // The bank's own abbreviated form of the counterparty's name, "Тестовая П." — abbreviated, but
  // still a real person, and a live recording carried fourteen distinct ones.
  "maskedfio",
  "maskedFIO",
  // The cashier who rang up the purchase, named on the fiscal receipt: "Продавец-кассир
  // Сусляков А.Е." Nine of them were in the committed recording. Unlike the seller, an employee
  // is not public commercial data, and nothing reads this field.
  //
  // The seller stays — `user` and `userInn` name the shop, which the brand and merchant tests
  // are built on. Where a sole trader's registered name appears there it is the business's own
  // name, printed on every receipt it issues and listed in the public tax register.
  "operator",
]);

/**
 * Operation groups whose `description` and `subcategory` hold the counterparty's name rather
 * than a merchant's.
 *
 * The bank puts the same text in both fields, and what it means depends entirely on the group:
 * under `PAY` it is "Пятёрочка", under `TRANSFER` it is "Тестовая П.". Redacting the fields
 * outright would take the merchant names the mapper and the contract test are built on;
 * redacting nothing leaves people's names in a committed fixture. So the group decides, and it
 * sits on the same object.
 *
 * `INCOME` is here too. Its descriptions are the account holder's employer and salary lines
 * where they are not a person's name outright, which is no less identifying.
 */
const COUNTERPARTY_GROUPS = new Set(["TRANSFER", "INCOME"]);

/**
 * `payment.fieldsValues` is a bag of payment form fields, and nothing in the connector reads any
 * of it. Every review round has pulled one more identifier out of it — `pointer`, then `message`,
 * then `pointerLinkId` and `qrId` and `subscriptionId` and `messageId`, then a nested
 * `operationId` — because each was named one at a time while the bag kept its defaults.
 *
 * So the default is inverted here: inside this subtree everything is redacted except a short
 * list of enum-like shape fields. A field the bank adds tomorrow is redacted before anyone has
 * heard of it, which is the opposite of how the rest of this file has had to work.
 */
// `additionalInfo` is the same shape as the form-field bag — a list of label/value pairs — and
// gets the same treatment for the same reason: the label is a caption the bank chose, the value is
// whatever it chose to put there. In this recording that was «Номер банкомата» / `007103`: which
// cash machine, which is a place and a time.
const FORM_FIELD_BAG_KEYS = new Set(["fieldsvalues", "additionalinfo"]);

/** What survives inside that bag: values that classify the payment rather than identify it. */
const FORM_FIELD_BAG_KEPT = new Set([
  "pointertype",
  "workflowtype",
  "dstcurrency",
  "mcc",
  "fieldname",
]);

/** The fields those groups fill with a name. */
const COUNTERPARTY_TEXT_KEYS = new Set(["description", "subcategory", "merchantkey"]);

/**
 * A receipt is default-deny, for the same reason the form-field bag is — and with four rounds of
 * evidence behind it. Every previous round added the field that round's leak was found in, and the
 * next round found the next field: a phone, a counterparty, a transfer note, a cashier. The receipt
 * is the densest personal record in the recording — it says what a person bought, where they stood
 * when they bought it, and at what minute — so listing what to remove was never going to converge.
 *
 * The connector reads exactly one field of a receipt, `items` (`hasReceiptItems`, and the line-item
 * mapper). `user` and `userInn` stay by an explicit decision: they are the seller, a legal entity
 * whose name and tax number are public commercial data, and the merchant assertions rest on them.
 * Everything else — `retailPlaceAddress`, `retailPlace`, `region`, the fiscal block, the totals —
 * is redacted whether or not anyone thought of it, including whatever the bank adds next.
 */
/**
 * The merchant, default-deny for the third time in this file — and the reason is now a pattern
 * rather than a guess. The receipt gave up its address; `posId` and `pointOfSaleId` gave up the
 * till; and `merchant.region.city` gave up eleven cities across two months, which against the
 * timestamps is where the account holder lives and where they travelled.
 *
 * Three fields are read and stay: `name` is the merchant text the mapper and the dedupe hash are
 * built on, `mcc` classifies the purchase, and `id` is the fallback for the receipt request key.
 * Everything else goes, `region` included, and so does whatever the bank nests there next.
 */
const MERCHANT_KEYS = new Set(["merchant"]);
const MERCHANT_KEPT = new Set(["name", "mcc", "id"]);

const RECEIPT_KEYS = new Set(["receipt"]);
const RECEIPT_KEPT = new Set(["items", "user", "userinn"]);

/**
 * Inside an item, the numbers the mapper reads and nothing else. `brand_id` and `good_id` are the
 * merchant's catalogue keys, which nothing reads.
 */
const RECEIPT_ITEM_KEPT = new Set([
  "price",
  "sum",
  "quantity",
  "ndsrate",
  "nds",
  "measurename",
  "unit",
]);

/**
 * The item's name is read — it becomes the line item's title — so it cannot simply go. It is also
 * the most sensitive string in the file: the recording holds prescription medication by brand,
 * strength and pack size, against a timestamp and a pharmacy. A positional label keeps the arrays,
 * the quantities and the sums intact, keeps the items distinguishable from each other so a mapper
 * that swapped two would still show, and carries nothing back. Position within its own receipt, so
 * it is stable no matter whether one entry or a whole cassette is scrubbed in a call.
 */
const RECEIPT_ITEM_NAME_KEYS = new Set(["name", "title"]);
const RECEIPT_ITEM_LABEL = "Позиция";

/**
 * Free-form text a person typed, redacted wherever it appears rather than by group.
 *
 * The committed recording carried ten transfer notes — a birthday message, a contribution to
 * the upkeep of a grave, the settlement of a dispute over an apartment lease. The leak scan
 * called the file clean: those strings hold no digit run and no masked name. The group rule
 * would not have caught them either, because one of them sits at
 * `payment.fieldsValues.message`, three levels below the object that names the group.
 *
 * So these are unconditional. That is the third time a rule scoped to where a value was last
 * seen has missed the same value somewhere else, and a note somebody wrote is never what a
 * cassette is for. The mapper does read `message` into a transaction's comment, and on replay
 * it now reads "REDACTED" — which the replay test proves changes nothing it checks.
 */
const FREE_TEXT_KEYS = new Set([
  "message",
  "comment",
  "note",
  "purpose",
  "paymentpurpose",
  "paymentmessage",
]);

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
 * "Тестовая П.", "Testcase L.". Anchored to a complete JSON string value, because the point is to
 * catch a name in a field nobody has named yet without catching "Ave Bistro & Gelato" in the
 * merchant field beside it.
 */
const MASKED_PERSON_NAME = /"([A-ZА-ЯЁ][a-zа-яё]{1,30} [A-ZА-ЯЁ]\.)"/g;

/** The same shape, matched against a complete string rather than inside a serialized payload. */
const WHOLE_MASKED_PERSON_NAME = /^[A-ZА-ЯЁ][a-zа-яё]{1,30} [A-ZА-ЯЁ]\.$/;

/**
 * A merchant's order reference, embedded in the description of a purchase: "Оплата заказа
 * №a71787b8-5aaf-4cbc-9f47-68f162763215", "Заказ №214139831". The committed recording carried
 * two UUIDs and four numeric references — none long enough for the digit rule, and all of them
 * able to tie the public cassette to one customer's order in the merchant's own records.
 *
 * The `№` and the words around it stay: what the purchase was for is the merchant text the
 * mapper and these tests are built on. Only the reference itself goes.
 */
const ORDER_REFERENCE = /(№\s*)[0-9A-Za-z][0-9A-Za-z-]{3,}/g;

/** A UUID anywhere, order reference or not. Nothing a cassette needs is shaped like one. */
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

/**
 * A Russian postal index opening an address — "109316, Москва, Волгоградский проспект, 42, к 9".
 * The receipt walk redacts these by structure now, so this exists for the address that turns up
 * somewhere else: a shape rule survives the bank moving the field, and the field list is what has
 * failed every round so far. Anchored to the opening quote of a JSON string: the scan runs
 * over the serialized cassette, and an unanchored "six digits, comma, whitespace" also describes
 * `"pointOfSaleId": 123456,` and the indentation of the next line — three false positives on the
 * real fixture, every one of them an ordinary number sitting next to a line break.
 */
const POSTAL_ADDRESS = /"\d{6},\s[^"\n]{4,}/g;

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
    .replace(PHONE_NUMBER, REDACTED)
    .replace(UUID, REDACTED)
    .replace(ORDER_REFERENCE, `$1${REDACTED}`);
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
type ScrubContext = "open" | "formFieldBag" | "receipt" | "receiptItem" | "merchant";

/**
 * One item, with its name replaced by its position. The walk redacts the name along with every
 * other non-kept field first; this puts the label in its place afterwards, so a name under a key
 * nobody listed still ends up as a label rather than as itself.
 */
function scrubReceiptItem(item: unknown, index: number): unknown {
  const scrubbed = scrubValue(item, false, "receiptItem");
  if (!scrubbed || typeof scrubbed !== "object" || Array.isArray(scrubbed)) return scrubbed;
  const result = scrubbed as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (RECEIPT_ITEM_NAME_KEYS.has(key.toLowerCase()) && typeof result[key] === "string") {
      result[key] = `${RECEIPT_ITEM_LABEL} ${index + 1}`;
    }
  }
  return result;
}

function scrubValue(value: unknown, preserve: boolean, context: ScrubContext = "open"): unknown {
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
  // The context has to survive the array, or an object inside an array-valued field drops back to
  // allow-by-default — which is the exact hole the default-deny rule was added to close, reopened
  // one level down.
  //
  // Carrying the context is not enough on its own, though: a *scalar* element never reaches the
  // object walk where default-deny is enforced, it returns from the string branch above. So
  // `fieldsValues: { aliases: ["Alice"] }` came through untouched — the key was denied, the array
  // inherited the denial, and then each string quietly ignored it. Scalars are redacted here,
  // where the context is still in hand.
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (context !== "open" && (entry === null || typeof entry !== "object")) {
        return entry === null ? null : REDACTED;
      }
      return scrubValue(entry, preserve, context);
    });
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    // Read before walking: whether `description` holds a merchant or a person is decided by the
    // `group` sitting beside it, so the sibling has to be in hand before the field is reached.
    const group = (value as Record<string, unknown>).group;
    const namesCounterparty =
      typeof group === "string" && COUNTERPARTY_GROUPS.has(group.toUpperCase());

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase();

      if (context === "formFieldBag" && !FORM_FIELD_BAG_KEPT.has(lowered)) {
        result[key] =
          entry === null || typeof entry === "object"
            ? scrubValue(entry, false, "formFieldBag")
            : REDACTED;
        continue;
      }
      if (FORM_FIELD_BAG_KEYS.has(lowered)) {
        result[key] = scrubValue(entry, false, "formFieldBag");
        continue;
      }
      if (context === "receiptItem" && !RECEIPT_ITEM_KEPT.has(lowered)) {
        result[key] =
          entry === null || typeof entry === "object"
            ? scrubValue(entry, false, "receiptItem")
            : REDACTED;
        continue;
      }
      if (context === "receipt" && lowered === "items" && Array.isArray(entry)) {
        result[key] = entry.map((item, index) => scrubReceiptItem(item, index));
        continue;
      }
      if (context === "receipt" && !RECEIPT_KEPT.has(lowered)) {
        result[key] =
          entry === null || typeof entry === "object"
            ? scrubValue(entry, false, "receipt")
            : REDACTED;
        continue;
      }
      if (context === "merchant" && !MERCHANT_KEPT.has(lowered)) {
        result[key] =
          entry === null || typeof entry === "object"
            ? scrubValue(entry, false, "merchant")
            : REDACTED;
        continue;
      }
      if (RECEIPT_KEYS.has(lowered)) {
        result[key] = scrubValue(entry, false, "receipt");
        continue;
      }
      if (MERCHANT_KEYS.has(lowered) && entry !== null && typeof entry === "object") {
        result[key] = scrubValue(entry, false, "merchant");
        continue;
      }
      if (namesCounterparty && COUNTERPARTY_TEXT_KEYS.has(lowered)) {
        result[key] = entry === null ? null : REDACTED;
        continue;
      }
      if (FREE_TEXT_KEYS.has(lowered) && typeof entry === "string") {
        // An empty one carries nothing and blanking it would only obscure that the field was
        // present and empty, which is part of the shape the cassette records.
        result[key] = entry === "" ? entry : REDACTED;
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
  // Exactly the four the replay needs, and no more. `buildOperationKey` reads `id`,
  // `operationId.value` and `authorizationId`; `extractReceiptRequestKey` reads the same three
  // and the URL carries the result as `receiptRequestKey`. Everything else that was listed here
  // — `paymentId`, `trackingId`, `ucid`, `documentId`, `receiptId`, `subgroupId`, `groupId` —
  // was exempted defensively and matched nothing: the committed cassette held 48 twelve-digit
  // payment ids and 459 thirty-two-character tracking ids that no request is keyed by, exempt
  // from the scrub and from the leak scan at once. `trackingId` is the only one the connector
  // reads at all, and only into debug metadata.
  "id",
  "operationid",
  "authorizationid",
  "receiptrequestkey",
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

  // The bank's masked-name form — "Тестовая П.", "Testcase L." — as a whole JSON string value. It
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

  for (const match of serialized.matchAll(UUID)) {
    const leak = `uuid: ${match[0]}`;
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

  for (const match of serialized.matchAll(POSTAL_ADDRESS)) {
    const start = match.index;
    if (start === undefined) continue;

    const key = enclosingKey(serialized, start);
    if (key && REFERENCE_KEYS.has(key.toLowerCase())) continue;

    const leak = key ? `postal address under "${key}"` : "postal address";
    if (reported.has(leak)) continue;
    reported.add(leak);
    leaks.push(leak);
  }

  return leaks;
}
