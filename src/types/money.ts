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

export type MoneyLineStatus = "final" | "returned" | "cancelled";

export type MoneyAssignmentMethod = "import" | "rule" | "llm" | "manual";

export const MONEY_ACCOUNT_KINDS: MoneyAccountKind[] = [
  "card",
  "debit",
  "credit",
  "cash",
];

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

export const MONEY_LINE_STATUSES: MoneyLineStatus[] = [
  "final",
  "returned",
  "cancelled",
];

export const MONEY_ASSIGNMENT_METHODS: MoneyAssignmentMethod[] = [
  "import",
  "rule",
  "llm",
  "manual",
];

export const MONEY_CURRENCIES = ["RUB", "USD"] as const;
export type MoneyCurrency = (typeof MONEY_CURRENCIES)[number];

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
// money_categories
// ============================================================================

export interface MoneyCategory {
  id: string;
  parent_id: string | null;
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
  depth: number;
  name_ru: string;
  name_en: string;
  slug: string;
}

export interface UpdateMoneyCategoryInput {
  parent_id?: string | null;
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
  is_transfer: boolean;
  transfer_group_id: string | null;
  raw_payload: Record<string, unknown> | null;
  dedupe_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMoneyTransactionInput {
  payer_person_id: string;
  account_id: string;
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
  is_transfer?: boolean;
  transfer_group_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
  dedupe_hash?: string | null;
}

export interface UpdateMoneyTransactionInput {
  account_id?: string;
  posted_at?: string;
  amount?: number;
  currency?: MoneyCurrency | string;
  transaction_type?: MoneyTransactionType;
  status?: MoneyTransactionStatus;
  merchant_name?: string | null;
  mcc?: string | null;
  comment?: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface CreateMoneyLineItemInput {
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
}

export interface MoneyTransactionDetail extends MoneyTransaction {
  line_items: MoneyLineItem[];
}
