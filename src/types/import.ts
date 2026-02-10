// ============================================================================
// Import framework types (canonical payload, connector contract)
// ============================================================================

import type {
  MoneyTransactionType,
  MoneyTransactionStatus,
} from "./money";

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
  is_transfer: boolean;
  transfer_group_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
  dedupe_hash: string;
  line_item: ImportLineItem;
}

/** Result of connector parse(); errors optional for validation messages */
export interface ImportParseResult {
  transactions: CanonicalTransactionRow[];
  errors?: string[];
}

/** Connector contract: each connector implements parse() and produces canonical rows */
export interface MoneyImportConnector {
  sourceId: string;
  displayName: string;
  parse(file: File): Promise<ImportParseResult>;
}

/**
 * Row shape sent to money_upsert_transactions_batch RPC.
 * account_id is required (resolved from account_hint in UI).
 */
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
  is_transfer: boolean;
  transfer_group_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
  dedupe_hash: string;
  line_item: ImportLineItem;
}

/** Per-row result from money_upsert_transactions_batch */
export interface MoneyUpsertRowResult {
  idx: number;
  status: "inserted" | "skipped" | "error";
  message?: string | null;
}

/** RPC result from money_upsert_transactions_batch */
export interface MoneyUpsertBatchResult {
  inserted: number;
  skipped: number;
  row_results?: MoneyUpsertRowResult[];
  error?: string;
}
