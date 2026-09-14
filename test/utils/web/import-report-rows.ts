import {
  REPORT_PAYLOAD_KEYS,
  REPORT_RAW_MARKERS,
  REPORT_ROW_COLUMNS,
} from "@/lib/money/import-report-rows";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let cursor: unknown = value;
  for (const step of path) cursor = asRecord(cursor)[step];
  return cursor ?? null;
}

/**
 * What PostgREST returns for one full row under `REPORT_ROW_SELECT`: the columns as they are,
 * each payload key and raw marker as its aliased field, missing ones null. Lets a test keep
 * writing rows with a payload while the page reads the projected shape.
 */
export function projectReportRow(row: Record<string, unknown>): Record<string, unknown> {
  const payload = asRecord(row.payload);
  const projected: Record<string, unknown> = {};
  for (const column of REPORT_ROW_COLUMNS) projected[column] = row[column] ?? null;
  for (const key of REPORT_PAYLOAD_KEYS) projected[`p_${key}`] = payload[key] ?? null;
  for (const [name, path] of Object.entries(REPORT_RAW_MARKERS)) {
    projected[`raw_${name}`] = readPath(payload.raw_payload, path);
  }
  return projected;
}

export function projectReportRows(rows: unknown): unknown {
  return Array.isArray(rows) ? rows.map((row) => projectReportRow(asRecord(row))) : rows;
}
