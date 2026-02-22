import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/database.types.ts";
import {
  buildTransactionInsertPayload,
  extractAccountHintFromRow,
  isUniqueViolation,
  normalizeSourceForTransactions,
  normalizeText,
  sha256Hex,
  toIsoOrNull,
  toNumberOrNull,
} from "./normalize.ts";
import type {
  CanonicalTransactionRowInput,
  ImportLineItemInput,
  UserAuthContext,
} from "./types.ts";

export interface MoneyImportRepository {
  authenticateAllowedUser(token: string): Promise<UserAuthContext | null>;
  getSessionByToken(token: string): Promise<Record<string, unknown> | null>;
  findLastImportedAt(source: string, payerPersonId: string): Promise<string | null>;
  createImportSession(payload: Record<string, unknown>): Promise<{ id: string }>;
  getImportSessionForUser(
    sessionId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null>;
  getImportSessionById(sessionId: string): Promise<Record<string, unknown> | null>;
  updateImportSession(sessionId: string, patch: Record<string, unknown>): Promise<void>;
  createImportBatch(payload: Record<string, unknown>): Promise<string>;
  getImportBatch(batchId: string): Promise<Record<string, unknown> | null>;
  updateImportBatch(batchId: string, patch: Record<string, unknown>): Promise<void>;
  resolveAccountIdForRow(
    payerPersonId: string,
    row: CanonicalTransactionRowInput,
    fallbackSource: string,
  ): Promise<string>;
  insertOrResolveTransaction(
    row: CanonicalTransactionRowInput,
    payerPersonId: string,
  ): Promise<{ transactionId: string; inserted: boolean }>;
  insertLineItemIfNew(
    transactionId: string,
    lineItem: ImportLineItemInput,
    importHash: string,
    fallbackAmount: number,
  ): Promise<{ lineItemId: string | null; inserted: boolean }>;
  insertReportRow(payload: Record<string, unknown>): Promise<string>;
}

export interface MoneyImportRepositoryConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  createClientFn?: typeof createClient;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

export function createSupabaseMoneyImportRepository(
  config: MoneyImportRepositoryConfig = {},
): MoneyImportRepository {
  const createClientFn = config.createClientFn ?? createClient;
  const supabaseUrl = config.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = config.supabaseAnonKey ?? Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey =
    config.supabaseServiceRoleKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let adminClient: SupabaseClient<Database> | null = null;

  function getAdminClient(): SupabaseClient<Database> {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Supabase environment not configured");
    }
    if (!adminClient) {
      adminClient = createClientFn<Database>(supabaseUrl, supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return adminClient;
  }

  function createUserAuthClient(token: string): SupabaseClient<Database> {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase anon environment not configured");
    }
    return createClientFn<Database>(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function authenticateAllowedUser(token: string): Promise<UserAuthContext | null> {
    try {
      const userClient = createUserAuthClient(token);
      const {
        data: { user },
        error: authError,
      } = await userClient.auth.getUser(token);

      if (authError || !user) return null;

      const { data: allowedUser, error: allowlistError } = await getAdminClient()
        .from("allowed_users")
        .select("id")
        .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
        .single();

      if (allowlistError || !allowedUser) return null;
      return {
        mode: "user",
        token,
        userId: user.id,
        email: user.email ?? null,
      };
    } catch {
      return null;
    }
  }

  async function getSessionByToken(token: string): Promise<Record<string, unknown> | null> {
    const tokenHash = await sha256Hex(token);
    const { data, error } = await getAdminClient()
      .from("money_import_sessions")
      .select("*")
      .eq("token_hash", tokenHash)
      .single();

    if (error || !data) return null;
    return data as Record<string, unknown>;
  }

  async function findLastImportedAt(source: string, payerPersonId: string): Promise<string | null> {
    const { data, error } = await getAdminClient()
      .from("money_transactions")
      .select("posted_at")
      .eq("source", source)
      .eq("payer_person_id", payerPersonId)
      .order("posted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return toIsoOrNull((data as Record<string, unknown>).posted_at);
  }

  async function createImportSession(payload: Record<string, unknown>): Promise<{ id: string }> {
    const { data, error } = await getAdminClient()
      .from("money_import_sessions")
      .insert(payload as Database["public"]["Tables"]["money_import_sessions"]["Insert"])
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Failed to create import session");
    }

    return { id: (data as Record<string, unknown>).id as string };
  }

  async function getImportSessionForUser(
    sessionId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await getAdminClient()
      .from("money_import_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("created_by_auth_user_id", userId)
      .single();

    if (error || !data) return null;
    return data as Record<string, unknown>;
  }

  async function getImportSessionById(sessionId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await getAdminClient()
      .from("money_import_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error || !data) return null;
    return data as Record<string, unknown>;
  }

  async function updateImportSession(
    sessionId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await getAdminClient()
      .from("money_import_sessions")
      .update(patch as Database["public"]["Tables"]["money_import_sessions"]["Update"])
      .eq("id", sessionId);

    if (error) throw new Error(error.message);
  }

  async function createImportBatch(payload: Record<string, unknown>): Promise<string> {
    const { data, error } = await getAdminClient()
      .from("money_import_batches")
      .insert(payload as Database["public"]["Tables"]["money_import_batches"]["Insert"])
      .select("id")
      .single();

    if (error || !data) throw new Error(error?.message || "Failed to create import batch");
    return (data as Record<string, unknown>).id as string;
  }

  async function getImportBatch(batchId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await getAdminClient()
      .from("money_import_batches")
      .select("*")
      .eq("id", batchId)
      .single();

    if (error || !data) return null;
    return data as Record<string, unknown>;
  }

  async function updateImportBatch(batchId: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await getAdminClient()
      .from("money_import_batches")
      .update(patch as Database["public"]["Tables"]["money_import_batches"]["Update"])
      .eq("id", batchId);

    if (error) throw new Error(error.message);
  }

  async function resolveAccountIdForRow(
    payerPersonId: string,
    row: CanonicalTransactionRowInput,
    fallbackSource: string,
  ): Promise<string> {
    const explicitAccountId = normalizeText(row.account_id);
    if (explicitAccountId) return explicitAccountId;

    const sourceForAccounts = normalizeSourceForTransactions(
      normalizeText(row.source) ?? fallbackSource,
    );

    const { data: accounts, error: accountsError } = await getAdminClient()
      .from("money_accounts")
      .select("id")
      .eq("owner_person_id", payerPersonId)
      .eq("source", sourceForAccounts);

    if (accountsError) {
      throw new Error(accountsError.message || "Failed to resolve money account");
    }

    const accountIds = (accounts ?? [])
      .map((item) => normalizeText((item as Record<string, unknown>).id))
      .filter((value): value is string => Boolean(value));

    if (accountIds.length === 0) {
      throw new Error(`No money account found for source ${sourceForAccounts}`);
    }

    const accountHint = extractAccountHintFromRow(row);
    if (accountHint && accountIds.length > 0) {
      const { data: cards, error: cardsError } = await getAdminClient()
        .from("money_cards")
        .select("account_id")
        .eq("last4", accountHint)
        .in("account_id", accountIds);

      if (cardsError) {
        throw new Error(cardsError.message || "Failed to resolve account by card hint");
      }

      const matchedAccountIds = Array.from(
        new Set(
          (cards ?? [])
            .map((item) => normalizeText((item as Record<string, unknown>).account_id))
            .filter((value): value is string => Boolean(value)),
        ),
      );

      if (matchedAccountIds.length === 1) {
        return matchedAccountIds[0];
      }
    }

    if (accountIds.length === 1) return accountIds[0];
    throw new Error("account_id is required and could not be resolved");
  }

  async function findExistingTransactionId(
    row: CanonicalTransactionRowInput,
  ): Promise<string | null> {
    let query = getAdminClient().from("money_transactions").select("id").limit(1);
    if (row.external_id) {
      query = query.eq("source", row.source ?? "manual").eq("external_id", row.external_id);
    } else if (row.dedupe_hash) {
      query = query.eq("dedupe_hash", row.dedupe_hash);
    } else {
      return null;
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return normalizeText((data as Record<string, unknown>).id);
  }

  async function insertOrResolveTransaction(
    row: CanonicalTransactionRowInput,
    payerPersonId: string,
  ): Promise<{ transactionId: string; inserted: boolean }> {
    const payload = buildTransactionInsertPayload(row, payerPersonId);
    const { data, error } = await getAdminClient()
      .from("money_transactions")
      .insert(payload as Database["public"]["Tables"]["money_transactions"]["Insert"])
      .select("id")
      .single();

    if (!error && data) {
      return {
        transactionId: (data as Record<string, unknown>).id as string,
        inserted: true,
      };
    }

    if (!isUniqueViolation(error)) {
      throw new Error((error as { message?: string })?.message || "Failed to insert transaction");
    }

    const existingId = await findExistingTransactionId(row);
    if (!existingId) {
      throw new Error("Duplicate transaction but existing row could not be resolved");
    }

    return { transactionId: existingId, inserted: false };
  }

  async function insertLineItemIfNew(
    transactionId: string,
    lineItem: ImportLineItemInput,
    importHash: string,
    fallbackAmount: number,
  ): Promise<{ lineItemId: string | null; inserted: boolean }> {
    const payload = {
      transaction_id: transactionId,
      title: normalizeText(lineItem.title) ?? "Imported",
      amount: toNumberOrNull(lineItem.amount) ?? fallbackAmount,
      quantity: toNumberOrNull(lineItem.quantity),
      unit: normalizeText(lineItem.unit),
      line_status: "final",
      assignment_method: "import" as const,
      raw_payload: asRecord(lineItem.raw_payload),
      import_hash: importHash,
    };

    const { data, error } = await getAdminClient()
      .from("money_line_items")
      .insert(payload as Database["public"]["Tables"]["money_line_items"]["Insert"])
      .select("id")
      .single();

    if (!error && data) {
      return {
        lineItemId: (data as Record<string, unknown>).id as string,
        inserted: true,
      };
    }

    if (!isUniqueViolation(error)) {
      throw new Error((error as { message?: string })?.message || "Failed to insert line item");
    }

    const { data: existing } = await getAdminClient()
      .from("money_line_items")
      .select("id")
      .eq("transaction_id", transactionId)
      .eq("import_hash", importHash)
      .limit(1)
      .maybeSingle();

    return {
      lineItemId: existing ? ((existing as Record<string, unknown>).id as string) : null,
      inserted: false,
    };
  }

  async function insertReportRow(payload: Record<string, unknown>): Promise<string> {
    const { data, error } = await getAdminClient()
      .from("money_import_batch_rows")
      .insert(payload as Database["public"]["Tables"]["money_import_batch_rows"]["Insert"])
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Failed to insert report row");
    }

    return (data as Record<string, unknown>).id as string;
  }

  return {
    authenticateAllowedUser,
    getSessionByToken,
    findLastImportedAt,
    createImportSession,
    getImportSessionForUser,
    getImportSessionById,
    updateImportSession,
    createImportBatch,
    getImportBatch,
    updateImportBatch,
    resolveAccountIdForRow,
    insertOrResolveTransaction,
    insertLineItemIfNew,
    insertReportRow,
  };
}
