export const CONNECTOR_TYPES = {
  FILE: "file",
  EXTENSION: "extension",
} as const;

export interface ConnectorDebugConfig {
  enabled?: boolean;
  parse_only?: boolean;
  tab_id?: number;
  debug_run_id?: string;
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
  response_status_histogram?: Record<string, number>;
  stage_timings_ms?: Record<string, number>;
  mapping_drop_counts?: Record<string, number>;
  api_operation_count?: number;
  mapped_row_count?: number;
  rows_without_line_items?: number;
}

export interface ConnectorParseInput {
  source: string;
  windowFrom?: string;
  windowTo?: string;
  session?: Record<string, unknown>;
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
