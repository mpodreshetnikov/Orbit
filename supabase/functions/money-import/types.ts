export type RowStatus = "inserted" | "skipped" | "error";
export type RangeSelectionMode = "auto" | "preset" | "custom";
export type RangePresetKey = "1m" | "3m" | "6m" | "1y" | "since_last_import";

export interface RangeSelectionMeta {
  selection_mode: RangeSelectionMode;
  preset_key: RangePresetKey | null;
  prompted_for_history: boolean;
  last_imported_at_at_decision_time: string | null;
  stale_threshold_days: number;
}

export interface ImportLineItemInput {
  title?: string | null;
  amount?: number | null;
  quantity?: number | null;
  unit?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

export interface ExistingTransactionStateCandidate {
  external_id?: string | null;
  dedupe_hash?: string | null;
  posted_at?: string | null;
  amount?: number | null;
}

export interface ExistingTransactionStateResult {
  transaction_id: string | null;
  exists: boolean;
  fulfilled: boolean;
  has_only_synthetic_line_items: boolean;
  has_real_line_items: boolean;
  receipt_enrichment_status: ReceiptEnrichmentStatus | null;
}

export interface SourceCategoryInput {
  id?: string | null;
  name?: string | null;
}

export interface SourceBrandInput {
  source_key?: string | null;
  name?: string | null;
  website_url?: string | null;
  logo_url?: string | null;
  base_color?: string | null;
  base_text_color?: string | null;
}

export type BrandResolutionAction = "match_existing" | "create_new";

export interface BatchBrandResolutionInput {
  source: string;
  source_key: string;
  source_name: string;
  website_url?: string | null;
  logo_url?: string | null;
  base_color?: string | null;
  base_text_color?: string | null;
  suggested_brand_id?: string | null;
  suggested_confidence: number;
  suggested_reason?: string | null;
  selected_action: BrandResolutionAction;
  selected_brand_id?: string | null;
}

export type ReceiptEnrichmentStatus =
  | "ok"
  | "rate_limited"
  | "skipped_after_budget"
  | "not_requested"
  | "error";

export interface CanonicalTransactionRowInput {
  source?: string | null;
  external_id?: string | null;
  posted_at: string;
  amount: number;
  account_hint?: string | null;
  currency?: string | null;
  transaction_type: string;
  status?: string | null;
  merchant_name?: string | null;
  mcc?: string | null;
  comment?: string | null;
  source_comment?: string | null;
  cashback_amount?: number | null;
  cashback_currency?: string | null;
  operation_icon_url?: string | null;
  source_category?: SourceCategoryInput | null;
  source_brand?: SourceBrandInput | null;
  source_category_id?: string | null;
  source_category_name?: string | null;
  brand_id?: string | null;
  receipt_request_key?: string | null;
  receipt_enrichment_status?: ReceiptEnrichmentStatus | null;
  receipt_line_items_skipped?: boolean;
  receipt_retryable?: boolean;
  receipt_retry_attempts?: number;
  receipt_result_code?: string | null;
  receipt_tracking_id?: string | null;
  receipt_message?: string | null;
  is_transfer?: boolean | null;
  transfer_group_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
  dedupe_hash?: string | null;
  account_id?: string | null;
  card_id?: string | null;
  line_items?: ImportLineItemInput[] | null;
}

export interface UserAuthContext {
  mode: "user";
  token: string;
  userId: string;
  email: string | null;
}

export interface SessionAuthContext {
  mode: "session";
  token: string;
  session: Record<string, unknown>;
}

/**
 * A long-lived credential the extension holds so it can start an import without a person
 * being there. Narrower than a user token: it may only create sessions, and only for the
 * person and sources it was issued for.
 */
export interface GrantAuthContext {
  mode: "grant";
  token: string;
  grant: Record<string, unknown>;
}

export type AuthContext = UserAuthContext | SessionAuthContext | GrantAuthContext;
