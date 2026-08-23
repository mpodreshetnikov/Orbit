/**
 * T-Bank operations CSV connector.
 * Format: semicolon-delimited, double-quoted fields, Russian locale numbers.
 */

import { buildMoneyDedupeHash } from "@shared/lib/money/dedupe";
import { registerConnector } from "../connector-types";
import type { CanonicalTransactionRow, ImportParseResult } from "@/types";

const SOURCE_ID = "tbank";

export const COL = {
  DATE_OP: "Дата операции",
  DATE_PAY: "Дата платежа",
  CARD: "Номер карты",
  STATUS: "Статус",
  AMOUNT_OP: "Сумма операции",
  CURRENCY_OP: "Валюта операции",
  CATEGORY: "Категория",
  MCC: "MCC",
  DESCRIPTION: "Описание",
} as const;

/** Parse semicolon-separated CSV with double-quoted fields */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        cell += c;
      }
    } else if (c === ";") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((s) => s.length > 0)) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((s) => s.length > 0)) rows.push(row);
  }
  return rows;
}

/**
 * A T-Bank statement prints wall-clock time in Moscow, with no offset in the text. Moscow
 * has been a fixed UTC+03:00 with no daylight saving since 2014, so the offset can be
 * written down rather than looked up — this is deliberate, not an oversight. Reading the
 * statement as UTC (the old behaviour) shifted every operation three hours back, which
 * moved late-evening purchases into the previous calendar day in reports and put statement
 * rows a fixed three hours away from the same operation seen through the bank's API.
 */
export const TBANK_STATEMENT_TIMEZONE_OFFSET = "+03:00";

export function parseTBankDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const withTime = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;
  const dateOnly = /^(\d{2})\.(\d{2})\.(\d{4})$/;
  let m = t.match(withTime);
  if (m) {
    const [, d, mo, y, h, min, sec] = m;
    return new Date(
      `${y}-${mo}-${d}T${h}:${min}:${sec}${TBANK_STATEMENT_TIMEZONE_OFFSET}`,
    ).toISOString();
  }
  m = t.match(dateOnly);
  if (m) {
    const [, d, mo, y] = m;
    return new Date(`${y}-${mo}-${d}T00:00:00${TBANK_STATEMENT_TIMEZONE_OFFSET}`).toISOString();
  }
  return null;
}

export function parseAmount(s: string): number {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

export function extractAccountHint(card: string): string {
  const t = card.trim().replace(/\*/g, "").trim();
  if (t.length >= 4) return t.slice(-4);
  return t || "";
}

/** Fixed heuristic: only "Между своими счетами" for internal transfer */
export function isTransfer(category: string, description: string): boolean {
  const cat = category.trim();
  const desc = description.trim();
  return cat === "Переводы" && desc === "Между своими счетами";
}

async function parse(file: File): Promise<ImportParseResult> {
  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length < 2) {
    return { transactions: [], errors: ["CSV has no header or data rows"] };
  }

  const header = rows[0];
  const colIndex = (name: string) => header.indexOf(name);
  const idx = {
    dateOp: colIndex(COL.DATE_OP),
    datePay: colIndex(COL.DATE_PAY),
    card: colIndex(COL.CARD),
    status: colIndex(COL.STATUS),
    amount: colIndex(COL.AMOUNT_OP),
    currency: colIndex(COL.CURRENCY_OP),
    category: colIndex(COL.CATEGORY),
    mcc: colIndex(COL.MCC),
    description: colIndex(COL.DESCRIPTION),
  };

  const transactions: CanonicalTransactionRow[] = [];
  const errors: string[] = [];
  const occurrenceCounts = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const get = (index: number) =>
      index >= 0 && row[index] !== undefined ? String(row[index]).trim() : "";

    const dateOp = get(idx.dateOp);
    const datePay = get(idx.datePay);
    const postedAtRaw = dateOp || datePay;
    const postedAt = parseTBankDate(postedAtRaw);
    if (!postedAt) {
      errors.push(`Row ${i + 1}: invalid date`);
      continue;
    }

    const amount = parseAmount(get(idx.amount));
    const currency = get(idx.currency) || "RUB";
    const category = get(idx.category);
    const description = get(idx.description);
    const transfer = isTransfer(category, description);
    const transactionType = amount >= 0 ? "income" : transfer ? "transfer" : "expense";
    const status = get(idx.status).toUpperCase() === "OK" ? "posted" : "pending";
    const merchantName = description || null;
    const mccRaw = get(idx.mcc);
    const mcc = mccRaw ? mccRaw : null;
    const accountHint = extractAccountHint(get(idx.card));

    const rawPayload: Record<string, unknown> = {};
    header.forEach((h, j) => {
      if (row[j] !== undefined) rawPayload[h] = row[j];
    });

    // Two identical purchases on the same day at the same merchant for the same amount
    // would otherwise hash alike and the second would vanish as a duplicate. Statement
    // rows arrive in a stable order, so numbering repeats by position reproduces on a
    // re-import of the same period.
    const occurrenceKey = [postedAt, amount, currency, merchantName ?? "", accountHint].join("|");
    const occurrence = occurrenceCounts.get(occurrenceKey) ?? 0;
    occurrenceCounts.set(occurrenceKey, occurrence + 1);

    const dedupe_hash = await buildMoneyDedupeHash({
      source: SOURCE_ID,
      postedAtIso: postedAt,
      amount,
      currency,
      merchantName,
      accountHint: accountHint || null,
      occurrence,
    });

    transactions.push({
      account_hint: accountHint || null,
      source: SOURCE_ID,
      external_id: null,
      posted_at: postedAt,
      amount,
      currency,
      transaction_type: transactionType,
      status,
      merchant_name: merchantName,
      mcc,
      comment: null,
      operation_icon_url: null,
      source_category: {
        id: null,
        name: category || null,
      },
      source_brand: null,
      is_transfer: transfer,
      raw_payload: rawPayload,
      dedupe_hash,
      line_items: [
        // A statement carries no receipt composition, so this single line is a
        // placeholder for the whole operation and must be replaced — not joined — once
        // the extension fetches the real receipt.
        {
          title: merchantName || "T-Bank",
          amount,
          raw_payload: rawPayload,
          is_placeholder: true,
        },
      ],
    });
  }

  return { transactions, errors: errors.length > 0 ? errors : undefined };
}

const tbankConnector = {
  sourceId: SOURCE_ID,
  displayName: "T-Bank (CSV)",
  kind: "file" as const,
  fileAccept: {
    "text/csv": [".csv"],
    "text/plain": [".csv"],
    "application/vnd.ms-excel": [".csv"],
  },
  parse,
};

registerConnector(tbankConnector);

export { tbankConnector };
