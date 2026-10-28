/**
 * Who a transaction was with, read out of the bank's own operation payload.
 *
 * Orbit keeps the importer's copy of each bank operation in `raw_payload` (for
 * T-Bank, `raw_payload.operation`), and the transaction row only carries
 * `merchant_name`. For a card purchase that is the shop; for a transfer it is
 * whatever the bank put in `description`, and the details that say who sent the
 * money, through which channel and from which bank stay in the payload. This
 * pulls those out so an assistant can answer "who paid me" without reading the
 * payload itself.
 *
 * The payload is the bank's private JSON, so every read here is defensive: a
 * missing or reshaped field yields `null`, never a throw.
 */

export type CounterpartyDirection = "from" | "to";

export interface Counterparty {
  /** `from` for money that came in, `to` for money that went out. */
  direction: CounterpartyDirection;
  /** The other party as the bank names it: a person for a transfer, the merchant for a purchase. */
  name: string | null;
  /** How the money moved, as the bank labels it, e.g. "Пополнение по номеру телефона". */
  channel: string | null;
  /** The other party's bank, when the bank's payload names one. */
  bank: string | null;
}

/** Keys that hold card, account or contract numbers, or a phone: never handed to a client. */
const SENSITIVE_KEY = /card|account|agreement|ucid|pan$|token|phone|pointer|passport|inn$|bik$/i;
/** Keys that are presentation only and would just spend the client's context. */
const NOISE_KEY = /icon|logo|link|color|image|picture|url$/i;
const MAX_DEPTH = 4;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The bank's operation object inside an imported row's payload, if there is one. */
export function bankOperation(rawPayload: unknown): Record<string, unknown> | null {
  const payload = asRecord(rawPayload);
  return asRecord(payload?.operation);
}

/**
 * Finds a bank name anywhere in the operation: T-Bank has carried it under a few
 * keys over time (`bankName`, `bankMemberName`, `senderBankName`), sometimes
 * nested under `payment.fieldsValues`. `bankCategory` is the bank's spending
 * category, not a bank, and is skipped.
 */
function findBankName(value: unknown, depth = 0): string | null {
  const record = asRecord(value);
  if (!record || depth > MAX_DEPTH) return null;

  for (const [key, child] of Object.entries(record)) {
    if (/bank.*name|bankmember(name)?$/i.test(key) && !/category/i.test(key)) {
      const found = text(child) ?? text(asRecord(child)?.name);
      if (found) return found;
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (/category/i.test(key)) continue;
    const found = findBankName(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function describeCounterparty(row: {
  amount: number;
  is_transfer: boolean;
  merchant_name: string | null;
  raw_payload: unknown;
}): Counterparty {
  const operation = bankOperation(row.raw_payload);
  const direction: CounterpartyDirection = row.amount > 0 ? "from" : "to";
  const merchant = asRecord(operation?.merchant);
  const brand = asRecord(operation?.brand);

  const name =
    (direction === "from" ? text(operation?.senderDetails) : null) ??
    (row.is_transfer ? text(operation?.description) : null) ??
    text(merchant?.name) ??
    text(brand?.name) ??
    text(operation?.description) ??
    text(row.merchant_name);

  return {
    direction,
    name,
    channel: text(asRecord(operation?.subgroup)?.name),
    bank: operation ? findBankName(operation) : null,
  };
}

/**
 * The operation payload with numbers and presentation stripped, for a client
 * that asks for the bank's own view of a transaction. Card and account numbers
 * are removed by key, not masked, so a change in the bank's format cannot leak
 * one through a masking rule that no longer matches.
 */
export function sanitizeBankOperation(rawPayload: unknown): Record<string, unknown> | null {
  const operation = bankOperation(rawPayload);
  return operation ? (sanitize(operation, 0) as Record<string, unknown>) : null;
}

function sanitize(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    return depth >= MAX_DEPTH ? undefined : value.map((item) => sanitize(item, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return value;
  if (depth >= MAX_DEPTH) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (SENSITIVE_KEY.test(key) || NOISE_KEY.test(key)) continue;
    const cleaned = sanitize(child, depth + 1);
    if (cleaned !== undefined && cleaned !== null) out[key] = cleaned;
  }
  return out;
}
