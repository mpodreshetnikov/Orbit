/** Shapes the corpus stores on disk, and the normalised prediction the pipeline produces. */

/**
 * Compact case input. The pipeline expands this into a full
 * `MoneyCategorizeLlmBatchRequestItem` against the pinned candidate catalogue.
 *
 * Synthetic only — never copy production merchant/person identifiers here.
 */
export interface CaseInput {
  line_item_id: string;
  title: string;
  amount: number;
  merchant_name: string;
  mcc: string | null;
  currency: string;
  transaction_type: string;
  comment?: string;
  brand_name?: string | null;
  source?: string;
  posted_at?: string;
  quantity?: number;
  unit?: string | null;
  /** Other lines on the same receipt; empty for single-line merchants. */
  siblings?: CaseSiblingInput[];
}

export interface CaseSiblingInput {
  id: string;
  title: string;
  amount: number;
  quantity?: number;
  unit?: string | null;
  category_id?: string | null;
}

/**
 * Hand-checked label for one case.
 *
 * `category_id` is the Orbit category UUID (or null when the model should abstain).
 * `canonical_system_key` is scored alongside it so a correct bucket with a wrong id still
 * surfaces as a field mismatch rather than a total miss.
 */
export interface CaseExpected {
  category_id: string | null;
  canonical_system_key: string | null;
}

/** What the pipeline produced after parsing the provider response. */
export interface CasePrediction {
  category_id: string | null;
  canonical_system_key: string | null;
  reason: string | null;
}

export interface CaseDiagnostics {
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  model: string | null;
}
