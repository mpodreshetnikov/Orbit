export const CONNECTOR_TYPES = {
  FILE: "file",
  EXTENSION: "extension",
} as const;

export type ConnectorParseStrategy = "fast" | "full";

export interface ConnectorDebugConfig {
  enabled?: boolean;
  parse_only?: boolean;
  tab_id?: number;
  debug_run_id?: string;
  session_id?: string;
  on_progress?: (update: ConnectorProgressUpdate) => void | Promise<void>;
}

export interface ConnectorExistingTransactionStateCandidate {
  external_id?: string | null;
  dedupe_hash?: string | null;
  posted_at?: string | null;
  amount?: number | null;
}

export interface ConnectorExistingTransactionState {
  transaction_id: string | null;
  exists: boolean;
  fulfilled: boolean;
  has_only_synthetic_line_items: boolean;
  has_real_line_items: boolean;
  receipt_enrichment_status?:
    | "ok"
    | "rate_limited"
    | "skipped_after_budget"
    | "not_requested"
    | "error"
    | null;
}

export interface ConnectorProgressUpdate {
  phase: string;
  progress_percent: number;
  parsed_transactions_count?: number | null;
}

export interface ConnectorParseDebugSummary {
  extraction_method?: "api" | "dom";
  fallback_used?: boolean;
  fallback_reason?: string | null;
  blocked_reason?: string | null;
  discovered_endpoints?: {
    operations_api?: string | null;
    operation_detail_api?: string | null;
    tranche_offers_api?: string | null;
  };
  range_attempts?: Array<{
    start: number;
    end: number;
    status_code: number | null;
    payload_count: number | null;
  }>;
  range_request_count?: number;
  effective_chunk_span_days?: number | null;
  /** How many ranges were halved because their response looked truncated. */
  range_split_count?: number;
  /** How many responses looked truncated, whether or not splitting resolved it. */
  truncation_suspected_count?: number;
  /**
   * Ranges still at the page limit after being narrowed to a single day. This is the one
   * case where the connector cannot promise it fetched everything, and it must say so
   * rather than let a partly loaded window look complete.
   */
  truncation_unresolved_count?: number;
  /** True when the run is known not to cover its whole window. */
  partial_result?: boolean;
  first_operation_posted_at?: string | null;
  last_operation_posted_at?: string | null;
  page_originated_operations_request_seen?: boolean;
  response_status_histogram?: Record<string, number>;
  stage_timings_ms?: Record<string, number>;
  mapping_drop_counts?: Record<string, number>;
  api_operation_count?: number;
  mapped_row_count?: number;
  rows_without_line_items?: number;
  receipt_enrichment?: {
    requested_count?: number;
    success_count?: number;
    rate_limit_response_count?: number;
    rate_limited_count?: number;
    skipped_after_budget_count?: number;
    failed_count?: number;
    retry_attempts_total?: number;
    stopped_after_budget?: boolean;
    parse_strategy?: ConnectorParseStrategy;
    retry_strategy?: "shared_budget" | "progressive_backoff";
    base_pause_between_receipts_ms?: number;
    max_retry_pause_ms?: number;
    window_limit?: number;
    window_ms?: number;
    window_cooldown_count?: number;
    window_cooldown_total_ms?: number;
  };
  preflight_enrichment_skip_count?: number;
  fulfilled_skip_count?: number;
  out_of_range_skip_count?: number;
}

export interface ConnectorParseInput {
  source: string;
  windowFrom?: string;
  windowTo?: string;
  session?: Record<string, unknown>;
  get_existing_transaction_states?: (
    candidates: ConnectorExistingTransactionStateCandidate[],
  ) => Promise<ConnectorExistingTransactionState[]>;
  debug?: ConnectorDebugConfig;
}

export interface ConnectorParseOutput {
  rows: Record<string, unknown>[];
  windowTo: string;
  parsedThroughAt: string;
  parsedTransactionsCount: number;
  debug?: ConnectorParseDebugSummary;
}

export interface Connector {
  sourceId: string;
  displayName?: string;
  parse: (input: ConnectorParseInput) => Promise<ConnectorParseOutput>;
}
