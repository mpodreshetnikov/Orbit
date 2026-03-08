export type RowStatus = "inserted" | "skipped" | "error";

export interface ImportLineItemInput {
  title?: string | null;
  amount?: number | null;
  quantity?: number | null;
  unit?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

export interface CanonicalTransactionRowInput {
  source?: string | null;
  external_id?: string | null;
  posted_at: string;
  amount: number;
  currency?: string | null;
  transaction_type: string;
  status?: string | null;
  merchant_name?: string | null;
  mcc?: string | null;
  comment?: string | null;
  source_comment?: string | null;
  cashback_amount?: number | null;
  cashback_currency?: string | null;
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

export type AuthContext = UserAuthContext | SessionAuthContext;
