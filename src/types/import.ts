// ============================================================================
// Import framework types (canonical payload, connector contract)
// ============================================================================

import type { MoneyTransactionType, MoneyTransactionStatus } from "./money";

export type ImportConnectorKind = "file" | "extension";
export type MoneyImportBatchStatus = "pending" | "running" | "completed" | "failed" | "discarded";

/** Line item shape produced by connectors and sent in batch payload */
export interface ImportLineItem {
  title: string;
  amount: number;
  quantity?: number | null;
  unit?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

/**
 * Canonical transaction row from a connector (before account resolution).
 * account_id is optional; account_hint (e.g. card last4) is used to resolve to account_id in the UI.
 */
export interface CanonicalTransactionRow {
  account_id?: string | null;
  account_hint?: string | null;
  card_id?: string | null;
  source: string;
  external_id?: string | null;
  posted_at: string; // ISO
  amount: number;
  currency: string;
  transaction_type: MoneyTransactionType;
  status: MoneyTransactionStatus;
  merchant_name?: string | null;
  mcc?: string | null;
  comment?: string | null;
  source_comment?: string | null;
  cashback_amount?: number | null;
  cashback_currency?: string | null;
  is_transfer: boolean;
  transfer_group_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
  dedupe_hash?: string | null;
  line_items: ImportLineItem[];
}

/** Result of connector parse(); errors optional for validation messages */
export interface ImportParseResult {
  transactions: CanonicalTransactionRow[];
  errors?: string[];
}

interface MoneyImportConnectorBase {
  sourceId: string;
  displayName: string;
  kind: ImportConnectorKind;
  guideUrl?: string;
  websiteUrl?: string;
  fileAccept?: Record<string, string[]>;
}

/** File connector contract */
export interface MoneyFileImportConnector extends MoneyImportConnectorBase {
  kind: "file";
  parse(file: File): Promise<ImportParseResult>;
}

/** Extension connector contract (parsing is done in extension) */
export interface MoneyExtensionImportConnector extends MoneyImportConnectorBase {
  kind: "extension";
}

export type MoneyImportConnector = MoneyFileImportConnector | MoneyExtensionImportConnector;

/** Row shape sent to money-import Edge Function preview/apply actions. */
export interface BatchTransactionRow {
  account_id: string;
  card_id?: string | null;
  source: string;
  external_id?: string | null;
  posted_at: string;
  amount: number;
  currency: string;
  transaction_type: MoneyTransactionType;
  status: MoneyTransactionStatus;
  merchant_name?: string | null;
  mcc?: string | null;
  comment?: string | null;
  source_comment?: string | null;
  cashback_amount?: number | null;
  cashback_currency?: string | null;
  is_transfer: boolean;
  transfer_group_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
  dedupe_hash?: string | null;
  line_items: ImportLineItem[];
}

interface MoneyImportRowsRequestBase {
  source: string;
  payer_person_id: string;
  default_account_id?: string | null;
  import_type: "file" | "web_export";
  batch_id?: string;
  session_id?: string;
  file_path?: string | null;
  parsed_through_at?: string | null;
  parsed_transactions_count?: number;
  window_from?: string | null;
  window_to?: string | null;
  meta?: Record<string, unknown> | null;
  rows: BatchTransactionRow[];
}

export interface ImportApplyRowsRequest extends MoneyImportRowsRequestBase {
  action: "apply_rows";
}

export interface MoneyImportPreviewRowsRequest extends MoneyImportRowsRequestBase {
  action: "preview_rows";
}

export interface MoneyImportApplyBatchRequest {
  action: "apply_batch";
  batch_id: string;
}

export interface MoneyImportDiscardBatchRequest {
  action: "discard_batch";
  batch_id: string;
}

/** Per-row result from Edge apply_rows action */
export interface MoneyImportRowResult {
  idx: number;
  status: "inserted" | "skipped" | "error";
  message?: string | null;
  transaction_id?: string | null;
  line_results?: Array<{
    line_index: number;
    status: "inserted" | "skipped" | "error";
    message?: string | null;
    line_item_id?: string | null;
  }>;
}

/** Result from Edge apply_rows action */
export interface MoneyImportApplyResult {
  batch_id: string;
  inserted: number;
  skipped: number;
  error_count: number;
  row_results: MoneyImportRowResult[];
}

/** Result from Edge preview_rows action. Pending means preview-ready awaiting review. */
export type MoneyImportPreviewResult = MoneyImportApplyResult;

/** Result from Edge apply_batch action. */
export type MoneyImportApplyBatchResult = MoneyImportApplyResult;

/** Result from Edge discard_batch action. */
export interface MoneyImportDiscardBatchResult {
  batch_id: string;
  status: "discarded";
}

export interface MoneyImportSessionCreateResult {
  session_id: string;
  session_token: string;
  batch_id: string;
  source: string;
  payer_person_id: string;
  expires_at: string;
  ttl_minutes: number;
  last_imported_at: string | null;
}

export interface MoneyImportSessionStatus {
  session: {
    id: string;
    source: string;
    payer_person_id: string;
    status: string;
    expires_at: string;
    revoked_at: string | null;
    window_from: string | null;
    window_to: string | null;
    batch_id: string | null;
  };
  batch: {
    id: string;
    status: MoneyImportBatchStatus;
    parsed_transactions_count: number;
    parsed_through_at: string | null;
    inserted_count: number;
    skipped_count: number;
    error_count: number;
    completed_at: string | null;
    window_from: string | null;
    window_to: string | null;
    progress_percent: number | null;
  } | null;
}

export interface MoneyImportBatch {
  id: string;
  source: string;
  payer_person_id: string;
  import_type: string;
  status: MoneyImportBatchStatus;
  file_path: string | null;
  session_id: string | null;
  window_from: string | null;
  window_to: string | null;
  parsed_through_at: string | null;
  parsed_transactions_count: number;
  inserted_count: number;
  skipped_count: number;
  error_count: number;
  completed_at: string | null;
  created_at: string;
}

export interface MoneyImportBatchRow {
  id: string;
  batch_id: string;
  parent_row_id: string | null;
  row_kind: "transaction" | "line_item";
  source_row_index: number;
  source_line_index: number | null;
  status: "inserted" | "skipped" | "error";
  message: string | null;
  transaction_id: string | null;
  line_item_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}
