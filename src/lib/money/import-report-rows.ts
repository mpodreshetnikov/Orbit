import type { MoneyImportBatchRow } from "@/types";

/**
 * What the report asks of a batch row, column by column instead of `*`.
 *
 * A row's payload carries the bank's raw record: on 2026-09-14 `raw_payload` alone was 670 KB of
 * a 484-row batch's 1.05 MB, and `line_items` inside a transaction's payload repeats the line rows
 * that come on their own. The page reads a handful of payload keys and four markers from the raw
 * record, so that is what travels; the full payload is fetched when its JSON is opened.
 */
export const REPORT_ROW_COLUMNS = [
  "id",
  "batch_id",
  "parent_row_id",
  "row_kind",
  "source_row_index",
  "source_line_index",
  "status",
  "message",
  "transaction_id",
  "line_item_id",
  "receipt_request_key",
  "receipt_enrichment_status",
  "created_at",
] as const;

/** Top-level payload keys the report reads, for transaction rows and line rows alike. */
export const REPORT_PAYLOAD_KEYS = [
  "posted_at",
  "amount",
  "currency",
  "cashback_amount",
  "cashback_currency",
  "merchant_name",
  "title",
  "comment",
  "quantity",
  "unit",
  "card_id",
  "operation_icon_url",
  "source_category",
  "source_category_name",
  "source_brand",
  "selected_brand_id",
  "selected_action",
  "receipt_enrichment_status",
  "receipt_line_items_skipped",
] as const;

/** Markers the report reads inside `raw_payload`, each by its path there. */
export const REPORT_RAW_MARKERS: Readonly<Record<string, readonly string[]>> = {
  extraction_method: ["extraction_method"],
  source: ["source"],
  receipt_status: ["enrichment", "shopping_receipt", "status"],
  receipt_line_items_skipped: ["enrichment", "shopping_receipt", "line_items_skipped"],
};

const PAYLOAD_ALIAS = "p_";
const RAW_ALIAS = "raw_";

/** The PostgREST select for the report's rows: columns, then payload keys and markers by path. */
export const REPORT_ROW_SELECT: string = [
  ...REPORT_ROW_COLUMNS,
  ...REPORT_PAYLOAD_KEYS.map((key) => `${PAYLOAD_ALIAS}${key}:payload->${key}`),
  ...Object.entries(REPORT_RAW_MARKERS).map(
    ([name, path]) => `${RAW_ALIAS}${name}:payload->raw_payload->${path.join("->")}`,
  ),
].join(",");

function readRawMarkers(record: Record<string, unknown>): Record<string, unknown> | null {
  let raw: Record<string, unknown> | null = null;
  for (const [name, path] of Object.entries(REPORT_RAW_MARKERS)) {
    const value = record[`${RAW_ALIAS}${name}`];
    if (value === null || value === undefined) continue;
    raw ??= {};
    let cursor = raw;
    for (const step of path.slice(0, -1)) {
      const next = cursor[step];
      if (next && typeof next === "object") {
        cursor = next as Record<string, unknown>;
      } else {
        const created: Record<string, unknown> = {};
        cursor[step] = created;
        cursor = created;
      }
    }
    cursor[path[path.length - 1]!] = value;
  }
  return raw;
}

/** Puts a row the select above returned back into the shape the page reads. */
export function readReportRow(record: Record<string, unknown>): MoneyImportBatchRow {
  const payload: Record<string, unknown> = {};
  for (const key of REPORT_PAYLOAD_KEYS) {
    const value = record[`${PAYLOAD_ALIAS}${key}`];
    if (value !== null && value !== undefined) payload[key] = value;
  }
  const rawPayload = readRawMarkers(record);
  if (rawPayload) payload.raw_payload = rawPayload;

  const row: Record<string, unknown> = {};
  for (const column of REPORT_ROW_COLUMNS) row[column] = record[column] ?? null;
  row.payload = payload;
  return row as unknown as MoneyImportBatchRow;
}

export function readReportRows(data: unknown): MoneyImportBatchRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (record): record is Record<string, unknown> => Boolean(record) && typeof record === "object",
    )
    .map(readReportRow);
}
