import type { ImportParseResult, MoneyImportBatch, MoneyImportBatchRow } from "@orbit-types/import";
import { buildDedupeHashPayload } from "@orbit-types/money-import-dedupe";
import { readReportRows, REPORT_ROW_SELECT } from "@orbit-types/money-import-report-rows";
import { parseTBankCsv } from "@orbit-types/money-import-tbank-csv";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { supabase } from "@/lib/supabase";

export interface StatementFile {
  name: string;
  uri: string;
}

/** The statement the person picks from Files, or null when they close the picker. */
export async function pickStatement(): Promise<StatementFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "text/csv",
      "text/comma-separated-values",
      "text/plain",
      "public.comma-separated-values-text",
    ],
    copyToCacheDirectory: true,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  return asset ? { name: asset.name, uri: asset.uri } : null;
}

/**
 * Read a T-Bank statement into rows. The dedupe hash is the web's SHA-256 of the same payload,
 * built by `expo-crypto` because the phone has no `crypto.subtle`: an operation imported from
 * either is then known to the other.
 */
export async function readStatement(uri: string): Promise<ImportParseResult> {
  const text = await new File(uri).text();
  return parseTBankCsv(text, (...parts) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, buildDedupeHashPayload(...parts)),
  );
}

/** Call an action of the `money-import` Edge Function, with its own error message when it fails. */
export async function moneyImportAction<T>(action: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("money-import", { body: action });
  if (error) {
    const context = (error as { context?: { json?: () => Promise<{ error?: unknown }> } }).context;
    const body = await context?.json?.().catch(() => null);
    throw new Error(typeof body?.error === "string" ? body.error : error.message);
  }
  return data as T;
}

/** The person's imports, newest first. */
export async function fetchImportBatches(personId: string): Promise<MoneyImportBatch[]> {
  const { data, error } = await supabase
    .from("money_import_batches")
    .select("*")
    .eq("payer_person_id", personId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MoneyImportBatch[];
}

/**
 * Undo an applied import: what it added is deleted and the batch is marked rolled back, in one
 * database transaction (`money_rollback_import_batch`).
 */
export async function rollbackImportBatch(id: string): Promise<void> {
  const { error } = await supabase.rpc("money_rollback_import_batch", { p_batch_id: id });
  if (error) throw new Error(error.message);
}

/** How many report rows one read asks for: the API's own cap on a response. */
export const REPORT_PAGE = 1000;

/** A batch and its rows as the report reads them: the rows' payloads cut to what it shows. */
export async function fetchImportBatch(
  id: string,
): Promise<{ batch: MoneyImportBatch; rows: MoneyImportBatchRow[] } | null> {
  const batch = await supabase.from("money_import_batches").select("*").eq("id", id).maybeSingle();
  if (batch.error) throw new Error(batch.error.message);
  if (!batch.data) return null;
  // The API returns at most a page of rows per read, and a statement can hold more.
  const rows: unknown[] = [];
  for (let from = 0; ; from += REPORT_PAGE) {
    const page = await supabase
      .from("money_import_batch_rows")
      .select(REPORT_ROW_SELECT)
      .eq("batch_id", id)
      .order("source_row_index", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + REPORT_PAGE - 1);
    if (page.error) throw new Error(page.error.message);
    rows.push(...(page.data ?? []));
    if ((page.data ?? []).length < REPORT_PAGE) break;
  }
  return { batch: batch.data as MoneyImportBatch, rows: readReportRows(rows) };
}
