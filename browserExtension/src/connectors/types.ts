export const CONNECTOR_TYPES = {
  FILE: "file",
  EXTENSION: "extension",
} as const;

export interface ConnectorParseInput {
  source: string;
  windowFrom: string;
  windowTo?: string;
  session?: Record<string, unknown>;
}

export interface ConnectorParseOutput {
  rows: Record<string, unknown>[];
  windowTo: string;
  parsedThroughAt: string;
  parsedTransactionsCount: number;
}

export interface Connector {
  sourceId: string;
  displayName?: string;
  parse: (input: ConnectorParseInput) => Promise<ConnectorParseOutput>;
}
