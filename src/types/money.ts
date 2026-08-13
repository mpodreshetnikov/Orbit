// ============================================================================
// MONEY TYPES (accounts, transactions, line items, categories)
// ============================================================================

export type MoneyAccountKind = "card" | "debit" | "credit" | "cash";

export type MoneyTransactionType =
  | "expense"
  | "income"
  | "transfer"
  | "refund"
  | "fee"
  | "adjustment";

export type MoneyTransactionStatus = "posted" | "pending" | "cancelled";
export type MoneyTransferFilter = "all" | "only" | "exclude";
export type MoneyAmountSignFilter = "all" | "income" | "expense";
export type MoneyTransactionDatePreset = "7d" | "30d" | "3m" | "1y" | "all" | "custom";

export type MoneyLineStatus = "final" | "returned" | "cancelled";

export type MoneyAssignmentMethod = "import" | "rule" | "llm" | "manual";

export type MoneyCategoryKind = "canonical" | "custom";
export type MoneyCategoryRuleKind =
  | "direct"
  | "mcc_map"
  | "llm_categorization"
  | "fallback_uncategorized";

export type MoneyCategoryRuleMatchMode = "all" | "any";
export type MoneyCategoryRuleScopeFilter =
  | "all_line_items"
  | "uncategorized_only"
  | "custom_only"
  | "canonical_only"
  | "manual_unlocked_only";

export type MoneyCategoryRuleFilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "starts_with"
  | "regex"
  | "contains_any_in_set"
  | "equals_any_in_set"
  | "in_set"
  | "range"
  | "is_empty"
  | "is_not_empty";

export interface MoneyCategoryRuleFilter {
  field: string;
  operator: MoneyCategoryRuleFilterOperator;
  value?: string | number | boolean | null;
  values?: string[];
  min?: number | null;
  max?: number | null;
}

export interface MoneyCategoryRule {
  id: string;
  person_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  sort_order: number;
  rule_kind: MoneyCategoryRuleKind;
  target_category_id: string | null;
  match_mode: MoneyCategoryRuleMatchMode;
  scope_filter: MoneyCategoryRuleScopeFilter;
  filters: MoneyCategoryRuleFilter[];
  config: Record<string, unknown>;
  stop_processing: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMoneyCategoryRuleInput {
  person_id: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  sort_order: number;
  rule_kind: MoneyCategoryRuleKind;
  target_category_id?: string | null;
  match_mode?: MoneyCategoryRuleMatchMode;
  scope_filter?: MoneyCategoryRuleScopeFilter;
  filters?: MoneyCategoryRuleFilter[];
  config?: Record<string, unknown>;
  stop_processing?: boolean;
}

export interface UpdateMoneyCategoryRuleInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  sort_order?: number;
  rule_kind?: MoneyCategoryRuleKind;
  target_category_id?: string | null;
  match_mode?: MoneyCategoryRuleMatchMode;
  scope_filter?: MoneyCategoryRuleScopeFilter;
  filters?: MoneyCategoryRuleFilter[];
  config?: Record<string, unknown>;
  stop_processing?: boolean;
}

export interface MoneyCategoryRuleRunStep {
  id: string | null;
  rule_id: string;
  rule_name: string | null;
  rule_kind: MoneyCategoryRuleKind;
  sort_order: number;
  matched: boolean;
  changed_category: boolean;
  previous_category_id: string | null;
  next_category_id: string | null;
  decision_reason: string;
  debug_payload: Record<string, unknown>;
  created_at?: string | null;
}

export interface MoneyCategoryRuleRun {
  id: string | null;
  triggered_by_user_id: string | null;
  person_id: string;
  trigger_source: string;
  line_item_id: string;
  line_item_title: string | null;
  transaction_id: string;
  merchant_name: string | null;
  starting_category_id: string | null;
  final_category_id: string | null;
  saved: boolean;
  llm_tokens_prompt: number | null;
  llm_tokens_completion: number | null;
  created_at?: string | null;
  steps: MoneyCategoryRuleRunStep[];
}

export const MONEY_ACCOUNT_KINDS: MoneyAccountKind[] = ["card", "debit", "credit", "cash"];

export const MONEY_TRANSACTION_TYPES: MoneyTransactionType[] = [
  "expense",
  "income",
  "transfer",
  "refund",
  "fee",
  "adjustment",
];

export const MONEY_TRANSACTION_STATUSES: MoneyTransactionStatus[] = [
  "posted",
  "pending",
  "cancelled",
];

export const MONEY_LINE_STATUSES: MoneyLineStatus[] = ["final", "returned", "cancelled"];

export const MONEY_ASSIGNMENT_METHODS: MoneyAssignmentMethod[] = [
  "import",
  "rule",
  "llm",
  "manual",
];

export const MONEY_CATEGORY_RULE_KINDS: MoneyCategoryRuleKind[] = [
  "direct",
  "mcc_map",
  "llm_categorization",
  "fallback_uncategorized",
];

export const MONEY_CATEGORY_RULE_SCOPE_FILTERS: MoneyCategoryRuleScopeFilter[] = [
  "all_line_items",
  "uncategorized_only",
  "custom_only",
  "canonical_only",
  "manual_unlocked_only",
];

export const MONEY_CATEGORY_RULE_MATCH_MODES: MoneyCategoryRuleMatchMode[] = ["all", "any"];

export const MONEY_CURRENCIES = ["RUB", "USD"] as const;
export type MoneyCurrency = (typeof MONEY_CURRENCIES)[number];

/** Known account sources for import/display. Use "manual" for hand-entered accounts. */
export const MONEY_ACCOUNT_SOURCES = ["manual", "tbank", "alfa"] as const;
export type MoneyAccountSource = (typeof MONEY_ACCOUNT_SOURCES)[number];

// ============================================================================
// money_accounts
// ============================================================================

export interface MoneyAccount {
  id: string;
  owner_person_id: string;
  source: string;
  account_kind: MoneyAccountKind;
  account_label: string;
  currency: MoneyCurrency | string;
  external_account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateMoneyAccountInput {
  owner_person_id: string;
  source?: string;
  account_kind: MoneyAccountKind;
  account_label: string;
  currency: MoneyCurrency | string;
  external_account_id?: string | null;
  is_active?: boolean;
}

export interface UpdateMoneyAccountInput {
  source?: string;
  account_kind?: MoneyAccountKind;
  account_label?: string;
  currency?: MoneyCurrency | string;
  external_account_id?: string | null;
  is_active?: boolean;
}

// ============================================================================
// money_cards (card last4 linked to account for import mapping)
// ============================================================================

export interface MoneyCard {
  id: string;
  account_id: string;
  last4: string;
  card_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMoneyCardInput {
  account_id: string;
  last4: string;
  card_label?: string | null;
}

export interface UpdateMoneyCardInput {
  last4?: string;
  card_label?: string | null;
}

// ============================================================================
// money_categories
// ============================================================================

export interface MoneyCategory {
  id: string;
  parent_id: string | null;
  canonical_category_id: string;
  category_kind: MoneyCategoryKind;
  system_key: string | null;
  sort_order: number;
  created_by: string | null;
  depth: number;
  name_ru: string;
  name_en: string;
  slug: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMoneyCategoryInput {
  parent_id?: string | null;
  canonical_category_id: string;
  category_kind?: Extract<MoneyCategoryKind, "custom">;
  depth: number;
  name_ru: string;
  name_en: string;
  slug: string;
}

export interface UpdateMoneyCategoryInput {
  parent_id?: string | null;
  canonical_category_id?: string;
  category_kind?: MoneyCategoryKind;
  depth?: number;
  name_ru?: string;
  name_en?: string;
  slug?: string;
  archived_at?: string | null;
}

// ============================================================================
// money_transactions
// ============================================================================

export interface MoneyTransaction {
  id: string;
  payer_person_id: string;
  account_id: string;
  card_id: string | null;
  brand_id?: string | null;
  source: string;
  external_id: string | null;
  posted_at: string;
  amount: number;
  currency: MoneyCurrency | string;
  transaction_type: MoneyTransactionType;
  status: MoneyTransactionStatus;
  merchant_name: string | null;
  mcc: string | null;
  comment: string | null;
  source_comment?: string | null;
  cashback_amount?: number | null;
  cashback_currency?: string | null;
  operation_icon_url?: string | null;
  source_category_id?: string | null;
  source_category_name?: string | null;
  receipt_request_key?: string | null;
  receipt_enrichment_status?:
    | "ok"
    | "rate_limited"
    | "skipped_after_budget"
    | "not_requested"
    | "error"
    | null;
  is_transfer: boolean;
  transfer_group_id: string | null;
  raw_payload: Record<string, unknown> | null;
  dedupe_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface MoneyTransactionBrand {
  id: string;
  slug: string;
  name: string;
  website_url: string | null;
  logo_url: string | null;
  base_color: string | null;
  base_text_color: string | null;
  created_at: string;
  updated_at: string;
}

/** Card embedded when selecting transactions (e.g. via FK card_id) */
export interface MoneyTransactionCard {
  id: string;
  last4: string;
  card_label: string | null;
}

export interface CreateMoneyTransactionInput {
  payer_person_id: string;
  account_id: string;
  card_id?: string | null;
  source?: string;
  external_id?: string | null;
  posted_at: string;
  amount: number;
  currency: MoneyCurrency | string;
  transaction_type: MoneyTransactionType;
  status?: MoneyTransactionStatus;
  merchant_name?: string | null;
  mcc?: string | null;
  comment?: string | null;
  source_comment?: string | null;
  cashback_amount?: number | null;
  cashback_currency?: string | null;
  operation_icon_url?: string | null;
  source_category_id?: string | null;
  source_category_name?: string | null;
  receipt_request_key?: string | null;
  receipt_enrichment_status?:
    | "ok"
    | "rate_limited"
    | "skipped_after_budget"
    | "not_requested"
    | "error"
    | null;
  brand_id?: string | null;
  is_transfer?: boolean;
  transfer_group_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
  dedupe_hash?: string | null;
}

export interface UpdateMoneyTransactionInput {
  account_id?: string;
  card_id?: string | null;
  posted_at?: string;
  amount?: number;
  currency?: MoneyCurrency | string;
  transaction_type?: MoneyTransactionType;
  status?: MoneyTransactionStatus;
  merchant_name?: string | null;
  mcc?: string | null;
  comment?: string | null;
  source_comment?: string | null;
  cashback_amount?: number | null;
  cashback_currency?: string | null;
  operation_icon_url?: string | null;
  source_category_id?: string | null;
  source_category_name?: string | null;
  receipt_request_key?: string | null;
  receipt_enrichment_status?:
    | "ok"
    | "rate_limited"
    | "skipped_after_budget"
    | "not_requested"
    | "error"
    | null;
  brand_id?: string | null;
  is_transfer?: boolean;
  transfer_group_id?: string | null;
}

// ============================================================================
// money_line_items
// ============================================================================

export interface MoneyLineItem {
  id: string;
  transaction_id: string;
  title: string;
  amount: number;
  quantity: number | null;
  unit: string | null;
  line_status: MoneyLineStatus;
  related_line_item_id: string | null;
  category_id: string | null;
  beneficiary_person_id: string | null;
  assignment_method: MoneyAssignmentMethod;
  assignment_rule_id: string | null;
  assignment_confidence: number | null;
  raw_payload: Record<string, unknown> | null;
  category_locked_by_user?: boolean;
  last_category_rule_id?: string | null;
  last_category_rule_run_id?: string | null;
  category_assigned_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMoneyLineItemInput {
  id?: string;
  transaction_id?: string;
  title: string;
  amount: number;
  quantity?: number | null;
  unit?: string | null;
  line_status?: MoneyLineStatus;
  related_line_item_id?: string | null;
  category_id?: string | null;
  beneficiary_person_id?: string | null;
  assignment_method?: MoneyAssignmentMethod;
  assignment_rule_id?: string | null;
  assignment_confidence?: number | null;
  raw_payload?: Record<string, unknown> | null;
  category_locked_by_user?: boolean;
  last_category_rule_id?: string | null;
  last_category_rule_run_id?: string | null;
  category_assigned_at?: string | null;
}

export interface UpdateMoneyLineItemInput {
  title?: string;
  amount?: number;
  quantity?: number | null;
  unit?: string | null;
  line_status?: MoneyLineStatus;
  related_line_item_id?: string | null;
  category_id?: string | null;
  beneficiary_person_id?: string | null;
  assignment_method?: MoneyAssignmentMethod;
  assignment_rule_id?: string | null;
  assignment_confidence?: number | null;
  category_locked_by_user?: boolean;
}

export interface MoneyTransactionDetail extends MoneyTransaction {
  line_items: MoneyLineItem[];
}

export interface MoneyTransactionFeedFilters {
  query?: string;
  accountIds?: string[];
  transactionTypes?: MoneyTransactionType[];
  statuses?: MoneyTransactionStatus[];
  categoryIds?: string[];
  transferFilter?: MoneyTransferFilter;
  amountSign?: MoneyAmountSignFilter;
  preset?: MoneyTransactionDatePreset;
  from?: string | null;
  to?: string | null;
}

export interface MoneyTransactionFeedItem extends MoneyTransaction {
  money_cards: MoneyTransactionCard | null;
  money_transaction_brands: MoneyTransactionBrand | null;
  line_item_titles: string[];
  category_ids: string[];
  line_item_count: number;
}

export interface MoneyTransactionFeedPage {
  items: MoneyTransactionFeedItem[];
  nextOffset: number | null;
}

export interface MoneyTransactionFeedSummary {
  totalCount: number;
  totalPositiveAmount: number;
  totalNegativeAmount: number;
}

export interface MoneyTransactionEditAudit {
  id: string;
  transaction_id: string;
  entity_kind: "transaction" | "line_item";
  entity_id: string;
  edited_by_auth_user_id: string | null;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  created_at: string;
}

// ============================================================================
// money_reports
// ============================================================================

export type MoneyBudgetChartMode = "expenses" | "income" | "net";

export interface MoneyBudgetTarget {
  id: string;
  person_id: string;
  category_id: string;
  month_start: string;
  target_amount: number;
  currency: MoneyCurrency | string;
  created_at: string;
  updated_at: string;
}

export interface MoneyTransferSelfAlias {
  id: string;
  person_id: string;
  alias: string;
  normalized_alias: string;
  created_at: string;
  updated_at: string;
}

export interface MoneyBudgetFxStatus {
  mode: "ok" | "approximate" | "missing";
  approximated_dates: string[];
  missing_pairs: string[];
  message: string | null;
  is_blocking: boolean;
}

export interface MoneyBudgetTrendPoint {
  date: string;
  income: number;
  expenses: number;
  net: number;
}

export interface MoneyBudgetSummary {
  actual_income: number;
  actual_expenses: number;
  actual_net: number;
  target_income: number;
  target_expenses: number;
  target_net: number;
  variance_net: number;
}

export interface MoneyBudgetCategoryNode {
  id: string;
  parent_id: string | null;
  canonical_category_id: string | null;
  depth: number;
  name_en: string;
  name_ru: string;
  slug: string | null;
  archived_at: string | null;
  is_uncategorized: boolean;
  actual_income: number;
  actual_expenses: number;
  actual_net: number;
  target_amount: number;
  variance_amount: number;
  target: MoneyBudgetTarget | null;
  children: MoneyBudgetCategoryNode[];
}

export interface MoneyBudgetReport {
  month_start: string;
  currency: MoneyCurrency | string;
  summary: MoneyBudgetSummary;
  categories: MoneyBudgetCategoryNode[];
  trend: MoneyBudgetTrendPoint[];
  fx_status: MoneyBudgetFxStatus;
}
