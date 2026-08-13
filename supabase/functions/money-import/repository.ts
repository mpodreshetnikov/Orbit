import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/database.types.ts";
import {
  BALANCING_LINE_ITEM_SOURCE,
  buildTransactionInsertPayload,
  extractAccountHintFromRow,
  hasOnlySyntheticImportLineItems,
  hasRealImportLineItems,
  isUniqueViolation,
  normalizeSourceForTransactions,
  normalizeText,
  sha256Hex,
  toIsoOrNull,
  toNumberOrNull,
} from "./normalize.ts";
import { createDefaultMoneyCategorizeDeps } from "../money-categorize/deps.ts";
import { applyMoneyCategoryRulePipelineService } from "../money-categorize/service.ts";
import type {
  BatchBrandResolutionInput,
  BrandResolutionAction,
  CanonicalTransactionRowInput,
  ExistingTransactionStateCandidate,
  ExistingTransactionStateResult,
  ImportLineItemInput,
  SourceBrandInput,
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
  getImportBatchForUser(batchId: string, userId: string): Promise<Record<string, unknown> | null>;
  updateImportBatch(batchId: string, patch: Record<string, unknown>): Promise<void>;
  resolveAccountIdForRow(
    payerPersonId: string,
    row: CanonicalTransactionRowInput,
    fallbackSource: string,
    defaultAccountId?: string | null,
  ): Promise<string>;
  resolveCardIdForRow(
    accountId: string,
    row: CanonicalTransactionRowInput,
    createIfMissing?: boolean,
  ): Promise<string | null>;
  resolveBrandIdForRow?(
    row: CanonicalTransactionRowInput,
    fallbackSource: string,
    createIfMissing?: boolean,
    preferredSelection?: {
      selected_action: BrandResolutionAction;
      selected_brand_id?: string | null;
    } | null,
  ): Promise<string | null>;
  previewBrandResolutionForRow?(
    row: CanonicalTransactionRowInput,
    fallbackSource: string,
  ): Promise<BatchBrandResolutionInput | null>;
  upsertBatchBrandResolution?(batchId: string, payload: BatchBrandResolutionInput): Promise<void>;
  getBatchBrandResolutionById?(resolutionId: string): Promise<Record<string, unknown> | null>;
  listBatchBrandResolutions?(batchId: string): Promise<Record<string, unknown>[]>;
  deleteBatchBrandResolutionsByBatch?(batchId: string): Promise<void>;
  updateBatchBrandResolutionSelection?(
    resolutionId: string,
    selectedAction: BrandResolutionAction,
    selectedBrandId: string | null,
  ): Promise<void>;
  getExistingTransactionStates(
    source: string,
    payerPersonId: string,
    candidates: ExistingTransactionStateCandidate[],
  ): Promise<ExistingTransactionStateResult[]>;
  findExistingTransactionId(
    row: CanonicalTransactionRowInput,
    payerPersonId: string,
  ): Promise<string | null>;
  findAdoptableTransactionId(
    row: CanonicalTransactionRowInput,
    payerPersonId: string,
  ): Promise<{ id: string } | { ambiguous: true } | null>;
  findExistingLineItemId(transactionId: string, importHash: string): Promise<string | null>;
  repairExistingTransactionDetails(
    transactionId: string,
    row: CanonicalTransactionRowInput,
  ): Promise<{
    replaced_synthetic_line_items: boolean;
    has_only_synthetic_line_items: boolean;
    has_real_line_items: boolean;
    blocked_by_manual_edit: boolean;
  }>;
  insertOrResolveTransaction(
    row: CanonicalTransactionRowInput,
    payerPersonId: string,
  ): Promise<{ transactionId: string; inserted: boolean; adopted?: boolean }>;
  insertLineItemIfNew(
    transactionId: string,
    lineItem: ImportLineItemInput,
    importHash: string,
    fallbackAmount: number,
    isPlaceholder?: boolean,
  ): Promise<{ lineItemId: string | null; inserted: boolean }>;
  insertReportRow(payload: Record<string, unknown>): Promise<string>;
  listReportRowsByBatch(batchId: string): Promise<Record<string, unknown>[]>;
  deleteReportRowsByBatch(batchId: string): Promise<void>;
  applyCategoryRulePipeline?(
    lineItemIds: string[],
    personId: string,
    triggerSource: string,
    forceOverwriteLocked?: boolean,
  ): Promise<Record<string, unknown>>;
}

export interface MoneyImportRepositoryConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  createClientFn?: typeof createClient;
  moneyCategorizeRunner?: (input: {
    lineItemIds: string[];
    personId: string;
    triggerSource: string;
    forceOverwriteLocked?: boolean;
  }) => Promise<Record<string, unknown>>;
}

/**
 * How far apart the statement's timestamp and the API's timestamp may be and still be the same
 * purchase. A statement distinguishes the operation date from the payment date, and those can sit a
 * couple of days apart; 72 hours covers that with room to spare while staying far below the gap
 * between two genuinely different purchases at the same merchant for the same amount.
 */
const ADOPTION_WINDOW_HOURS = 72;
/** Amounts are compared to the kopek, not by equality of floating point values. */
const ADOPTION_AMOUNT_TOLERANCE = 0.005;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function buildTransactionUpdatePayload(row: CanonicalTransactionRowInput): Record<string, unknown> {
  const payload = buildTransactionInsertPayload(row, "__repair__");
  delete payload.payer_person_id;
  return payload;
}

function sanitizeSlugSegment(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeComparableText(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeWebsiteHost(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function normalizeComparableUrl(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractLogoFileName(value: unknown): string | null {
  const normalizedUrl = normalizeComparableUrl(value);
  if (!normalizedUrl) return null;
  try {
    const parsed = new URL(normalizedUrl);
    const rawSegment = parsed.pathname.split("/").filter(Boolean).at(-1) ?? null;
    return rawSegment ? rawSegment.toLowerCase() : null;
  } catch {
    return null;
  }
}

function safeEnvGet(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

interface IndexedBrandCatalog {
  brandsById: Map<string, Record<string, unknown>>;
  aliasesByBrandId: Map<string, Record<string, unknown>[]>;
  brandIdsByName: Map<string, Set<string>>;
  brandIdsByWebsiteHost: Map<string, Set<string>>;
  brandIdsBySlug: Map<string, Set<string>>;
  brandIdsByLogoUrl: Map<string, Set<string>>;
  brandIdsByLogoFileName: Map<string, Set<string>>;
}

interface UntypedRuleExistsQuery extends PromiseLike<{
  data: Record<string, unknown>[] | null;
  error: { message?: string } | null;
}> {
  eq(column: string, value: unknown): UntypedRuleExistsQuery;
}

function addBrandIdToIndex(
  index: Map<string, Set<string>>,
  key: string | null,
  brandId: string,
): void {
  if (!key) return;
  const ids = index.get(key) ?? new Set<string>();
  ids.add(brandId);
  index.set(key, ids);
}

function addIndexedBrandCandidates(
  candidateBrandIds: Set<string>,
  index: Map<string, Set<string>>,
  key: string | null,
): void {
  if (!key) return;
  const brandIds = index.get(key);
  if (!brandIds) return;
  for (const brandId of brandIds) candidateBrandIds.add(brandId);
}

export function createSupabaseMoneyImportRepository(
  config: MoneyImportRepositoryConfig = {},
): MoneyImportRepository {
  const createClientFn = config.createClientFn ?? createClient;
  const supabaseUrl = config.supabaseUrl ?? safeEnvGet("SUPABASE_URL");
  const supabaseAnonKey = config.supabaseAnonKey ?? safeEnvGet("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey =
    config.supabaseServiceRoleKey ?? safeEnvGet("SUPABASE_SERVICE_ROLE_KEY");
  const moneyCategorizeRunner =
    config.moneyCategorizeRunner ??
    (async (input: {
      lineItemIds: string[];
      personId: string;
      triggerSource: string;
      forceOverwriteLocked?: boolean;
    }) => {
      const deps = createDefaultMoneyCategorizeDeps();
      const result = await applyMoneyCategoryRulePipelineService(
        {
          lineItemIds: input.lineItemIds,
          personId: input.personId,
          triggerSource: input.triggerSource,
          forceOverwriteLocked: input.forceOverwriteLocked ?? false,
          triggeredByUserId: null,
        },
        deps,
      );
      return result as unknown as Record<string, unknown>;
    });

  let adminClient: SupabaseClient<Database> | null = null;
  let brandCatalogCache: IndexedBrandCatalog | null = null;

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

  function invalidateBrandCatalogCache(): void {
    brandCatalogCache = null;
  }

  async function callAdminRpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const client = getAdminClient() as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };

    const { data, error } = await client.rpc(functionName, params);
    if (error) {
      throw new Error(error.message || `Failed to call ${functionName}`);
    }
    return (data as Record<string, unknown> | null) ?? {};
  }

  async function hasEnabledLlmCategoryRules(personId: string): Promise<boolean> {
    const client = getAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: unknown) => UntypedRuleExistsQuery;
        };
      };
    };
    const { data, error } = await client
      .from("money_category_rules")
      .select("id")
      .eq("person_id", personId)
      .eq("enabled", true)
      .eq("rule_kind", "llm_categorization");

    if (error) {
      throw new Error(error.message || "Failed to query money category rules");
    }

    return (data ?? []).length > 0;
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

  /**
   * Loads a batch only if it belongs to the calling user.
   *
   * RLS in this project is allowlist-only, and these actions run under the service-role key, so
   * ownership can be enforced nowhere but here. A batch created before the column existed and
   * without a session carries no owner; it stays reachable by any allowed user, because refusing it
   * would strand file imports that predate this change.
   */
  async function getImportBatchForUser(
    batchId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const batch = await getImportBatch(batchId);
    if (!batch) return null;

    const owner = normalizeText(batch.created_by_auth_user_id);
    if (owner && owner !== userId) return null;
    return batch;
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
    defaultAccountId?: string | null,
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

    const normalizedDefaultAccountId = normalizeText(defaultAccountId);
    if (normalizedDefaultAccountId && accountIds.includes(normalizedDefaultAccountId)) {
      return normalizedDefaultAccountId;
    }

    if (accountIds.length === 1) return accountIds[0];
    throw new Error("account_id is required and could not be resolved");
  }

  async function findExistingTransactionId(
    row: CanonicalTransactionRowInput,
    payerPersonId: string,
  ): Promise<string | null> {
    // Both keys are scoped to the person, matching the unique indexes. Unscoped, one person's
    // operation could be resolved as a duplicate of another's and silently overwritten.
    if (row.external_id) {
      const { data } = await getAdminClient()
        .from("money_transactions")
        .select("id")
        .eq("payer_person_id", payerPersonId)
        .eq("source", row.source ?? "manual")
        .eq("external_id", row.external_id)
        .limit(1)
        .maybeSingle();
      const id = data ? normalizeText((data as Record<string, unknown>).id) : null;
      if (id) return id;
    }

    if (row.dedupe_hash) {
      const { data } = await getAdminClient()
        .from("money_transactions")
        .select("id")
        .eq("payer_person_id", payerPersonId)
        .eq("dedupe_hash", row.dedupe_hash)
        .limit(1)
        .maybeSingle();
      const id = data ? normalizeText((data as Record<string, unknown>).id) : null;
      if (id) return id;
    }

    return null;
  }

  /**
   * Finds the statement transaction that an incoming API operation is the same purchase as.
   *
   * A row loaded from a CSV statement and the same operation seen by the extension never match on
   * either key: the statement row has no external_id, and the two hashes are computed from different
   * text — the bank's statement description on one side, the API's merchant name on the other. No
   * change to the hash formula fixes that. What does match is what actually agrees: the person, the
   * account, the amount to the kopek, and the instant within a tolerance.
   *
   * Returns `{ ambiguous: true }` rather than picking one when several candidates fit. Two identical
   * purchases on the same day are rare but real, and merging them loses an operation for good.
   */
  async function findAdoptableTransactionId(
    row: CanonicalTransactionRowInput,
    payerPersonId: string,
  ): Promise<{ id: string } | { ambiguous: true } | null> {
    const accountId = normalizeText(row.account_id);
    const postedAtIso = toIsoOrNull(row.posted_at);
    const amount = toNumberOrNull(row.amount);
    if (!accountId || !postedAtIso || amount === null) return null;

    const postedAtMs = new Date(postedAtIso).getTime();
    const windowMs = ADOPTION_WINDOW_HOURS * 60 * 60 * 1000;

    // Restricted to the same source, so a manually entered transaction is never adopted. A manual
    // row also has no external_id, sits on the same account and can easily carry the same amount on
    // the same day, and adoption overwrites the transaction's fields and identity — merging a
    // hand-entered operation into a bank one would be unrecoverable.
    const { data, error } = await getAdminClient()
      .from("money_transactions")
      .select("id, posted_at, amount")
      .eq("payer_person_id", payerPersonId)
      .eq("account_id", accountId)
      // Compared raw, exactly as findExistingTransactionId does and as the insert payload stores it.
      .eq("source", row.source ?? "manual")
      .is("external_id", null)
      .gte("posted_at", new Date(postedAtMs - windowMs).toISOString())
      .lte("posted_at", new Date(postedAtMs + windowMs).toISOString());

    if (error || !data) return null;

    const candidates = (data as Array<Record<string, unknown>>).filter((candidate) => {
      const candidateAmount = toNumberOrNull(candidate.amount);
      if (candidateAmount === null) return false;
      return Math.abs(candidateAmount - amount) < ADOPTION_AMOUNT_TOLERANCE;
    });

    if (candidates.length === 0) return null;
    if (candidates.length > 1) return { ambiguous: true };

    const id = normalizeText(candidates[0].id);
    return id ? { id } : null;
  }

  async function adoptTransaction(
    transactionId: string,
    row: CanonicalTransactionRowInput,
  ): Promise<void> {
    const { error } = await getAdminClient()
      .from("money_transactions")
      .update({
        external_id: row.external_id ?? null,
        dedupe_hash: row.dedupe_hash ?? null,
      } as Database["public"]["Tables"]["money_transactions"]["Update"])
      .eq("id", transactionId);
    if (error) {
      throw new Error(error.message || "Failed to adopt existing statement transaction");
    }
  }

  async function listLineItemsByTransactionIds(
    transactionIds: string[],
  ): Promise<Array<Record<string, unknown>>> {
    if (transactionIds.length === 0) return [];
    const { data, error } = await getAdminClient()
      .from("money_line_items")
      .select(
        "id, transaction_id, raw_payload, is_placeholder, category_locked_by_user, assignment_method",
      )
      .in("transaction_id", transactionIds);
    if (error || !data) return [];
    return data as Array<Record<string, unknown>>;
  }

  async function getExistingTransactionStates(
    source: string,
    payerPersonId: string,
    candidates: ExistingTransactionStateCandidate[],
  ): Promise<ExistingTransactionStateResult[]> {
    if (candidates.length === 0) return [];

    const externalIds = Array.from(
      new Set(
        candidates
          .map((candidate) => normalizeText(candidate.external_id))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const dedupeHashes = Array.from(
      new Set(
        candidates
          .map((candidate) => normalizeText(candidate.dedupe_hash))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const matchesByExternalId = new Map<string, Record<string, unknown>>();
    const matchesByDedupeHash = new Map<string, Record<string, unknown>>();

    if (externalIds.length > 0) {
      const { data } = await getAdminClient()
        .from("money_transactions")
        .select("id, source, external_id, dedupe_hash, receipt_enrichment_status")
        .eq("payer_person_id", payerPersonId)
        .eq("source", normalizeSourceForTransactions(source))
        .in("external_id", externalIds);
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const externalId = normalizeText(row.external_id);
        if (externalId) matchesByExternalId.set(externalId, row);
      }
    }

    if (dedupeHashes.length > 0) {
      const { data } = await getAdminClient()
        .from("money_transactions")
        .select("id, source, external_id, dedupe_hash, receipt_enrichment_status")
        .eq("payer_person_id", payerPersonId)
        .in("dedupe_hash", dedupeHashes);
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const dedupeHash = normalizeText(row.dedupe_hash);
        if (dedupeHash) matchesByDedupeHash.set(dedupeHash, row);
      }
    }

    const matchedTransactions = Array.from(
      new Set(
        candidates
          .map((candidate) => {
            const externalId = normalizeText(candidate.external_id);
            const dedupeHash = normalizeText(candidate.dedupe_hash);
            return (
              (externalId ? matchesByExternalId.get(externalId) : null) ??
              (dedupeHash ? matchesByDedupeHash.get(dedupeHash) : null) ??
              null
            );
          })
          .map((row) => normalizeText(row?.id))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const lineItems = await listLineItemsByTransactionIds(matchedTransactions);
    const lineItemsByTransactionId = new Map<string, ImportLineItemInput[]>();
    for (const row of lineItems) {
      const transactionId = normalizeText(row.transaction_id);
      if (!transactionId) continue;
      const existing = lineItemsByTransactionId.get(transactionId) ?? [];
      existing.push({
        raw_payload:
          row.raw_payload && typeof row.raw_payload === "object"
            ? (row.raw_payload as Record<string, unknown>)
            : null,
        is_placeholder: row.is_placeholder === true,
      });
      lineItemsByTransactionId.set(transactionId, existing);
    }

    return candidates.map((candidate) => {
      const externalId = normalizeText(candidate.external_id);
      const dedupeHash = normalizeText(candidate.dedupe_hash);
      const matchedRow =
        (externalId ? matchesByExternalId.get(externalId) : null) ??
        (dedupeHash ? matchesByDedupeHash.get(dedupeHash) : null) ??
        null;
      const transactionId = normalizeText(matchedRow?.id);
      if (!transactionId) {
        return {
          transaction_id: null,
          exists: false,
          fulfilled: false,
          has_only_synthetic_line_items: false,
          has_real_line_items: false,
          receipt_enrichment_status: null,
        };
      }

      const existingLineItems = lineItemsByTransactionId.get(transactionId) ?? [];
      const hasOnlySyntheticLineItems = hasOnlySyntheticImportLineItems(existingLineItems);
      const hasRealLineItems = hasRealImportLineItems(existingLineItems);
      const receiptEnrichmentStatus =
        (normalizeText(
          matchedRow?.receipt_enrichment_status,
        ) as ExistingTransactionStateResult["receipt_enrichment_status"]) ?? null;
      const fulfilled =
        hasRealLineItems &&
        (receiptEnrichmentStatus === "ok" || receiptEnrichmentStatus === "not_requested");

      return {
        transaction_id: transactionId,
        exists: true,
        fulfilled,
        has_only_synthetic_line_items: hasOnlySyntheticLineItems,
        has_real_line_items: hasRealLineItems,
        receipt_enrichment_status: receiptEnrichmentStatus,
      };
    });
  }

  async function findCardIdByAccountAndLast4(
    accountId: string,
    last4: string,
  ): Promise<string | null> {
    const { data, error } = await getAdminClient()
      .from("money_cards")
      .select("id")
      .eq("account_id", accountId)
      .eq("last4", last4)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return normalizeText((data as Record<string, unknown>).id);
  }

  async function resolveCardIdForRow(
    accountId: string,
    row: CanonicalTransactionRowInput,
    createIfMissing = true,
  ): Promise<string | null> {
    const explicitCardId = normalizeText(row.card_id);
    if (explicitCardId) return explicitCardId;

    const accountHint = extractAccountHintFromRow(row);
    if (!accountHint) return null;

    const existingCardId = await findCardIdByAccountAndLast4(accountId, accountHint);
    if (existingCardId) return existingCardId;
    if (!createIfMissing) return null;

    const { data, error } = await getAdminClient()
      .from("money_cards")
      .insert({
        account_id: accountId,
        last4: accountHint,
      } as Database["public"]["Tables"]["money_cards"]["Insert"])
      .select("id")
      .single();

    if (!error && data) {
      return normalizeText((data as Record<string, unknown>).id);
    }

    if (!isUniqueViolation(error)) {
      throw new Error((error as { message?: string })?.message || "Failed to create card");
    }

    return await findCardIdByAccountAndLast4(accountId, accountHint);
  }

  async function findExistingBrandIdByAlias(
    source: string,
    sourceKey: string,
  ): Promise<string | null> {
    const { data, error } = await getAdminClient()
      .from("money_transaction_brand_aliases")
      .select("brand_id")
      .eq("source", source)
      .eq("source_key", sourceKey)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return normalizeText((data as Record<string, unknown>).brand_id);
  }

  async function getExistingBrandAlias(
    source: string,
    sourceKey: string,
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await getAdminClient()
      .from("money_transaction_brand_aliases")
      .select("*")
      .eq("source", source)
      .eq("source_key", sourceKey)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as Record<string, unknown>;
  }

  async function listAllCanonicalBrands(): Promise<Record<string, unknown>[]> {
    const { data, error } = await getAdminClient()
      .from("money_transaction_brands")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message || "Failed to load canonical brands");
    return (data ?? []) as Record<string, unknown>[];
  }

  async function listAllBrandAliases(): Promise<Record<string, unknown>[]> {
    const { data, error } = await getAdminClient()
      .from("money_transaction_brand_aliases")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message || "Failed to load brand aliases");
    return (data ?? []) as Record<string, unknown>[];
  }

  function buildIndexedBrandCatalog(
    brands: Record<string, unknown>[],
    aliases: Record<string, unknown>[],
  ): IndexedBrandCatalog {
    const brandsById = new Map<string, Record<string, unknown>>();
    const aliasesByBrandId = new Map<string, Record<string, unknown>[]>();
    const brandIdsByName = new Map<string, Set<string>>();
    const brandIdsByWebsiteHost = new Map<string, Set<string>>();
    const brandIdsBySlug = new Map<string, Set<string>>();
    const brandIdsByLogoUrl = new Map<string, Set<string>>();
    const brandIdsByLogoFileName = new Map<string, Set<string>>();

    for (const brand of brands) {
      const brandId = normalizeText(brand.id);
      if (!brandId) continue;
      brandsById.set(brandId, brand);
      aliasesByBrandId.set(brandId, []);
      addBrandIdToIndex(brandIdsByName, normalizeComparableText(brand.name), brandId);
      addBrandIdToIndex(brandIdsByWebsiteHost, normalizeWebsiteHost(brand.website_url), brandId);
      addBrandIdToIndex(brandIdsBySlug, normalizeComparableText(brand.slug), brandId);
      addBrandIdToIndex(brandIdsByLogoUrl, normalizeComparableUrl(brand.logo_url), brandId);
      addBrandIdToIndex(brandIdsByLogoFileName, extractLogoFileName(brand.logo_url), brandId);
    }

    for (const alias of aliases) {
      const brandId = normalizeText(alias.brand_id);
      if (!brandId || !brandsById.has(brandId)) continue;
      const brandAliases = aliasesByBrandId.get(brandId) ?? [];
      brandAliases.push(alias);
      aliasesByBrandId.set(brandId, brandAliases);
      addBrandIdToIndex(brandIdsByName, normalizeComparableText(alias.source_name), brandId);
      addBrandIdToIndex(brandIdsByWebsiteHost, normalizeWebsiteHost(alias.website_url), brandId);
      addBrandIdToIndex(brandIdsByLogoUrl, normalizeComparableUrl(alias.logo_url), brandId);
      addBrandIdToIndex(brandIdsByLogoFileName, extractLogoFileName(alias.logo_url), brandId);
    }

    return {
      brandsById,
      aliasesByBrandId,
      brandIdsByName,
      brandIdsByWebsiteHost,
      brandIdsBySlug,
      brandIdsByLogoUrl,
      brandIdsByLogoFileName,
    };
  }

  async function getIndexedBrandCatalog(): Promise<IndexedBrandCatalog> {
    if (brandCatalogCache) return brandCatalogCache;
    const [brands, aliases] = await Promise.all([listAllCanonicalBrands(), listAllBrandAliases()]);
    brandCatalogCache = buildIndexedBrandCatalog(brands, aliases);
    return brandCatalogCache;
  }

  async function getBrandById(brandId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await getAdminClient()
      .from("money_transaction_brands")
      .select("*")
      .eq("id", brandId)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as Record<string, unknown>;
  }

  async function updateBrandIfMissingFields(
    brandId: string,
    sourceBrand: SourceBrandInput,
  ): Promise<void> {
    const existing = await getBrandById(brandId);
    if (!existing) return;

    const patch: Record<string, unknown> = {};
    if (!normalizeText(existing.name) && normalizeText(sourceBrand.name))
      patch.name = sourceBrand.name;
    if (!normalizeText(existing.website_url) && normalizeText(sourceBrand.website_url)) {
      patch.website_url = sourceBrand.website_url;
    }
    if (!normalizeText(existing.logo_url) && normalizeText(sourceBrand.logo_url)) {
      patch.logo_url = sourceBrand.logo_url;
    }
    if (!normalizeText(existing.base_color) && normalizeText(sourceBrand.base_color)) {
      patch.base_color = sourceBrand.base_color;
    }
    if (!normalizeText(existing.base_text_color) && normalizeText(sourceBrand.base_text_color)) {
      patch.base_text_color = sourceBrand.base_text_color;
    }

    if (Object.keys(patch).length === 0) return;

    const { error } = await getAdminClient()
      .from("money_transaction_brands")
      .update(patch as Database["public"]["Tables"]["money_transaction_brands"]["Update"])
      .eq("id", brandId);

    if (error) throw new Error(error.message || "Failed to update canonical brand");
    invalidateBrandCatalogCache();
  }

  async function upsertBrandAlias(
    brandId: string,
    source: string,
    sourceKey: string,
    sourceBrand: SourceBrandInput,
  ): Promise<void> {
    const brandName = normalizeText(sourceBrand.name);
    if (!brandName) throw new Error("Brand name is required");

    const existingAlias = await getExistingBrandAlias(source, sourceKey);
    const patch: Record<string, unknown> = {};
    if (!existingAlias) {
      const { error } = await getAdminClient()
        .from("money_transaction_brand_aliases")
        .insert({
          brand_id: brandId,
          source,
          source_key: sourceKey,
          source_name: brandName,
          website_url: normalizeText(sourceBrand.website_url),
          logo_url: normalizeText(sourceBrand.logo_url),
          base_color: normalizeText(sourceBrand.base_color),
          base_text_color: normalizeText(sourceBrand.base_text_color),
        } as Database["public"]["Tables"]["money_transaction_brand_aliases"]["Insert"]);

      if (!error) {
        invalidateBrandCatalogCache();
        return;
      }
      if (!isUniqueViolation(error)) {
        throw new Error((error as { message?: string })?.message || "Failed to create brand alias");
      }
      return await upsertBrandAlias(brandId, source, sourceKey, sourceBrand);
    }

    const existingBrandId = normalizeText(existingAlias.brand_id);
    if (existingBrandId !== brandId) patch.brand_id = brandId;
    if (!normalizeText(existingAlias.source_name)) patch.source_name = brandName;
    if (!normalizeText(existingAlias.website_url) && normalizeText(sourceBrand.website_url)) {
      patch.website_url = sourceBrand.website_url;
    }
    if (!normalizeText(existingAlias.logo_url) && normalizeText(sourceBrand.logo_url)) {
      patch.logo_url = sourceBrand.logo_url;
    }
    if (!normalizeText(existingAlias.base_color) && normalizeText(sourceBrand.base_color)) {
      patch.base_color = sourceBrand.base_color;
    }
    if (
      !normalizeText(existingAlias.base_text_color) &&
      normalizeText(sourceBrand.base_text_color)
    ) {
      patch.base_text_color = sourceBrand.base_text_color;
    }

    if (Object.keys(patch).length === 0) return;
    const aliasId = normalizeText(existingAlias.id);
    if (!aliasId) throw new Error("Brand alias id is missing");

    const { error } = await getAdminClient()
      .from("money_transaction_brand_aliases")
      .update(patch as Database["public"]["Tables"]["money_transaction_brand_aliases"]["Update"])
      .eq("id", aliasId);

    if (error) throw new Error(error.message || "Failed to update brand alias");
    invalidateBrandCatalogCache();
  }

  async function findOrCreateCanonicalBrand(sourceBrand: SourceBrandInput): Promise<string> {
    const brandName = normalizeText(sourceBrand.name);
    if (!brandName) throw new Error("Brand name is required");

    const sourceKey = normalizeText(sourceBrand.source_key) ?? brandName;
    const slugBase = sanitizeSlugSegment(brandName) || sanitizeSlugSegment(sourceKey);
    const slug = slugBase || `brand-${(await sha256Hex(sourceKey)).slice(0, 12)}`;

    const { data: existingBySlug, error: existingError } = await getAdminClient()
      .from("money_transaction_brands")
      .select("id")
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message || "Failed to load canonical brand");
    }
    if (existingBySlug) {
      const brandId = normalizeText((existingBySlug as Record<string, unknown>).id);
      if (!brandId) throw new Error("Canonical brand id is missing");
      await updateBrandIfMissingFields(brandId, sourceBrand);
      return brandId;
    }

    const { data, error } = await getAdminClient()
      .from("money_transaction_brands")
      .insert({
        slug,
        name: brandName,
        website_url: normalizeText(sourceBrand.website_url),
        logo_url: normalizeText(sourceBrand.logo_url),
        base_color: normalizeText(sourceBrand.base_color),
        base_text_color: normalizeText(sourceBrand.base_text_color),
      } as Database["public"]["Tables"]["money_transaction_brands"]["Insert"])
      .select("id")
      .single();

    if (!error && data) {
      const brandId = normalizeText((data as Record<string, unknown>).id);
      if (!brandId) throw new Error("Canonical brand id is missing");
      invalidateBrandCatalogCache();
      return brandId;
    }

    if (!isUniqueViolation(error)) {
      throw new Error(
        (error as { message?: string })?.message || "Failed to create canonical brand",
      );
    }

    const existingBrandId = await getAdminClient()
      .from("money_transaction_brands")
      .select("id")
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();

    const brandId = normalizeText((existingBrandId.data as Record<string, unknown> | null)?.id);
    if (!brandId) throw new Error("Canonical brand could not be resolved");
    invalidateBrandCatalogCache();
    await updateBrandIfMissingFields(brandId, sourceBrand);
    return brandId;
  }

  function scoreBrandCandidate(
    sourceBrand: SourceBrandInput,
    brand: Record<string, unknown>,
    aliases: Record<string, unknown>[],
  ): { confidence: number; reason: string | null } {
    const sourceName = normalizeComparableText(sourceBrand.name);
    const sourceHost = normalizeWebsiteHost(sourceBrand.website_url);
    const sourceLogoUrl = normalizeComparableUrl(sourceBrand.logo_url);
    const sourceLogoFileName = extractLogoFileName(sourceBrand.logo_url);
    const sourceSlug = sanitizeSlugSegment(normalizeText(sourceBrand.name) ?? "");

    const brandNameValues = [brand.name, ...aliases.map((alias) => alias.source_name)];
    const brandHostValues = [brand.website_url, ...aliases.map((alias) => alias.website_url)];
    const brandLogoValues = [brand.logo_url, ...aliases.map((alias) => alias.logo_url)];

    const nameMatch = Boolean(
      sourceName && brandNameValues.some((value) => normalizeComparableText(value) === sourceName),
    );
    const websiteMatch = Boolean(
      sourceHost && brandHostValues.some((value) => normalizeWebsiteHost(value) === sourceHost),
    );
    const slugMatch = Boolean(
      sourceSlug && normalizeComparableText(brand.slug) === normalizeComparableText(sourceSlug),
    );
    const logoUrlMatch = Boolean(
      sourceLogoUrl &&
      brandLogoValues.some((value) => normalizeComparableUrl(value) === sourceLogoUrl),
    );
    const logoFileNameMatch = Boolean(
      sourceLogoFileName &&
      brandLogoValues.some((value) => extractLogoFileName(value) === sourceLogoFileName),
    );

    if (websiteMatch && nameMatch) {
      return { confidence: 100, reason: "website_host_and_name_match" };
    }
    if (websiteMatch) return { confidence: 90, reason: "website_host_match" };
    if (nameMatch) return { confidence: 90, reason: "name_match" };
    if (slugMatch) return { confidence: 70, reason: "slug_match" };
    if (logoUrlMatch || logoFileNameMatch) return { confidence: 60, reason: "logo_match" };
    return { confidence: 0, reason: null };
  }

  function getCandidateBrandIdsForSourceBrand(
    sourceBrand: SourceBrandInput,
    catalog: IndexedBrandCatalog,
  ): string[] {
    const candidateBrandIds = new Set<string>();
    const sourceName = normalizeComparableText(sourceBrand.name);
    const sourceHost = normalizeWebsiteHost(sourceBrand.website_url);
    const sourceSlug = sanitizeSlugSegment(normalizeText(sourceBrand.name) ?? "");
    const sourceLogoUrl = normalizeComparableUrl(sourceBrand.logo_url);
    const sourceLogoFileName = extractLogoFileName(sourceBrand.logo_url);

    addIndexedBrandCandidates(candidateBrandIds, catalog.brandIdsByName, sourceName);
    addIndexedBrandCandidates(candidateBrandIds, catalog.brandIdsByWebsiteHost, sourceHost);
    addIndexedBrandCandidates(
      candidateBrandIds,
      catalog.brandIdsBySlug,
      sourceSlug ? normalizeComparableText(sourceSlug) : null,
    );
    addIndexedBrandCandidates(candidateBrandIds, catalog.brandIdsByLogoUrl, sourceLogoUrl);
    addIndexedBrandCandidates(
      candidateBrandIds,
      catalog.brandIdsByLogoFileName,
      sourceLogoFileName,
    );

    return Array.from(candidateBrandIds);
  }

  function isBankNativeBrandLabel(value: unknown): boolean {
    const text = normalizeText(value)?.toLowerCase();
    if (!text) return false;

    return /внутрибанковский перевод|внутрибанк(?:овский)? перевод|перевод 3-м лицам|перевод третьим лицам|между своими счетами|пополнение по номеру телефона|закрытие вклада|пополнение вклада|проценты на остаток|кэшбэк за обычные покупки|cashback payout|balance interest/.test(
      text,
    );
  }

  async function previewBrandResolutionForRow(
    row: CanonicalTransactionRowInput,
    fallbackSource: string,
  ): Promise<BatchBrandResolutionInput | null> {
    const sourceBrand = asRecord(row.source_brand) as SourceBrandInput | null;
    const brandName = normalizeText(sourceBrand?.name);
    const sourceKey = normalizeText(sourceBrand?.source_key) ?? brandName;
    if (!brandName || !sourceKey) return null;
    if (isBankNativeBrandLabel(brandName) || isBankNativeBrandLabel(sourceKey)) return null;

    const source = normalizeSourceForTransactions(normalizeText(row.source) ?? fallbackSource);
    const existingAlias = await getExistingBrandAlias(source, sourceKey);
    const existingBrandId = normalizeText(existingAlias?.brand_id);
    if (existingBrandId) {
      return {
        source,
        source_key: sourceKey,
        source_name: brandName,
        website_url: normalizeText(sourceBrand?.website_url),
        logo_url: normalizeText(sourceBrand?.logo_url),
        base_color: normalizeText(sourceBrand?.base_color),
        base_text_color: normalizeText(sourceBrand?.base_text_color),
        suggested_brand_id: existingBrandId,
        suggested_confidence: 100,
        suggested_reason: "existing_alias",
        selected_action: "match_existing",
        selected_brand_id: existingBrandId,
      };
    }

    const catalog = await getIndexedBrandCatalog();
    const scored = getCandidateBrandIdsForSourceBrand(
      { ...sourceBrand, name: brandName, source_key: sourceKey },
      catalog,
    )
      .map((brandId) => {
        const brand = catalog.brandsById.get(brandId);
        if (!brand) return null;
        const { confidence, reason } = scoreBrandCandidate(
          { ...sourceBrand, name: brandName, source_key: sourceKey },
          brand,
          catalog.aliasesByBrandId.get(brandId) ?? [],
        );
        if (confidence <= 0 || !reason) return null;
        return { brandId, confidence, reason };
      })
      .filter((candidate): candidate is { brandId: string; confidence: number; reason: string } =>
        Boolean(candidate),
      )
      .sort(
        (left, right) =>
          right.confidence - left.confidence || left.brandId.localeCompare(right.brandId),
      );

    const topCandidate = scored[0] ?? null;
    const tiedTopCandidates = topCandidate
      ? scored.filter((candidate) => candidate.confidence === topCandidate.confidence)
      : [];
    const isAmbiguous = tiedTopCandidates.length > 1;
    const suggestedBrandId = !topCandidate || isAmbiguous ? null : topCandidate.brandId;
    const suggestedConfidence = topCandidate?.confidence ?? 0;
    const suggestedReason = isAmbiguous ? "ambiguous_top_match" : (topCandidate?.reason ?? null);
    const selectedAction: BrandResolutionAction =
      suggestedBrandId && suggestedConfidence >= 90 ? "match_existing" : "create_new";
    const selectedBrandId = selectedAction === "match_existing" ? suggestedBrandId : null;

    return {
      source,
      source_key: sourceKey,
      source_name: brandName,
      website_url: normalizeText(sourceBrand?.website_url),
      logo_url: normalizeText(sourceBrand?.logo_url),
      base_color: normalizeText(sourceBrand?.base_color),
      base_text_color: normalizeText(sourceBrand?.base_text_color),
      suggested_brand_id: suggestedBrandId,
      suggested_confidence: suggestedConfidence,
      suggested_reason: suggestedReason,
      selected_action: selectedAction,
      selected_brand_id: selectedBrandId,
    };
  }

  async function resolveBrandIdForRow(
    row: CanonicalTransactionRowInput,
    fallbackSource: string,
    createIfMissing = true,
    preferredSelection: {
      selected_action: BrandResolutionAction;
      selected_brand_id?: string | null;
    } | null = null,
  ): Promise<string | null> {
    const explicitBrandId = normalizeText(row.brand_id);
    if (explicitBrandId) return explicitBrandId;

    const sourceBrand = asRecord(row.source_brand) as SourceBrandInput | null;
    const brandName = normalizeText(sourceBrand?.name);
    const sourceKey = normalizeText(sourceBrand?.source_key) ?? brandName;
    if (!brandName || !sourceKey) return null;
    if (isBankNativeBrandLabel(brandName) || isBankNativeBrandLabel(sourceKey)) return null;

    const source = normalizeSourceForTransactions(normalizeText(row.source) ?? fallbackSource);
    const normalizedSourceBrand: SourceBrandInput = {
      ...sourceBrand,
      name: brandName,
      source_key: sourceKey,
    };

    if (preferredSelection) {
      if (preferredSelection.selected_action === "match_existing") {
        const preferredBrandId = normalizeText(preferredSelection.selected_brand_id);
        if (!preferredBrandId) {
          throw new Error("Selected canonical brand is required");
        }
        await updateBrandIfMissingFields(preferredBrandId, normalizedSourceBrand);
        await upsertBrandAlias(preferredBrandId, source, sourceKey, normalizedSourceBrand);
        return preferredBrandId;
      }
      if (!createIfMissing) return null;
      const createdBrandId = await findOrCreateCanonicalBrand(normalizedSourceBrand);
      await upsertBrandAlias(createdBrandId, source, sourceKey, normalizedSourceBrand);
      return createdBrandId;
    }

    const existingBrandId = await findExistingBrandIdByAlias(source, sourceKey);
    if (existingBrandId) {
      await updateBrandIfMissingFields(existingBrandId, normalizedSourceBrand);
      return existingBrandId;
    }
    if (!createIfMissing) return null;

    const previewResolution = await previewBrandResolutionForRow(row, fallbackSource);
    if (
      previewResolution?.selected_action === "match_existing" &&
      normalizeText(previewResolution.selected_brand_id)
    ) {
      const matchedBrandId = normalizeText(previewResolution.selected_brand_id)!;
      await updateBrandIfMissingFields(matchedBrandId, normalizedSourceBrand);
      await upsertBrandAlias(matchedBrandId, source, sourceKey, normalizedSourceBrand);
      return matchedBrandId;
    }

    const brandId = await findOrCreateCanonicalBrand(normalizedSourceBrand);
    await upsertBrandAlias(brandId, source, sourceKey, normalizedSourceBrand);
    return brandId;
  }

  async function upsertBatchBrandResolution(
    batchId: string,
    payload: BatchBrandResolutionInput,
  ): Promise<void> {
    const client = getAdminClient() as unknown as {
      from: (table: string) => {
        upsert: (
          value: Record<string, unknown>,
          options: { onConflict: string },
        ) => Promise<{ error: { message?: string } | null }>;
      };
    };

    const { error } = await client.from("money_import_batch_brand_resolutions").upsert(
      {
        batch_id: batchId,
        ...payload,
      },
      { onConflict: "batch_id,source,source_key" },
    );

    if (error) {
      throw new Error(error.message || "Failed to save batch brand resolution");
    }
  }

  async function listBatchBrandResolutions(batchId: string): Promise<Record<string, unknown>[]> {
    const client = getAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (
            column: string,
            value: string,
          ) => {
            order: (
              column: string,
              options?: { ascending?: boolean },
            ) => Promise<{
              data: Record<string, unknown>[] | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };

    const { data, error } = await client
      .from("money_import_batch_brand_resolutions")
      .select("*")
      .eq("batch_id", batchId)
      .order("source_name", { ascending: true });

    if (error) {
      throw new Error(error.message || "Failed to load batch brand resolutions");
    }
    return data ?? [];
  }

  async function getBatchBrandResolutionById(
    resolutionId: string,
  ): Promise<Record<string, unknown> | null> {
    const client = getAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (
            column: string,
            value: string,
          ) => {
            limit: (value: number) => {
              maybeSingle: () => Promise<{
                data: Record<string, unknown> | null;
                error: { message?: string } | null;
              }>;
            };
          };
        };
      };
    };

    const { data, error } = await client
      .from("money_import_batch_brand_resolutions")
      .select("*")
      .eq("id", resolutionId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || "Failed to load batch brand resolution");
    }
    return data;
  }

  async function deleteBatchBrandResolutionsByBatch(batchId: string): Promise<void> {
    const client = getAdminClient() as unknown as {
      from: (table: string) => {
        delete: () => {
          eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
        };
      };
    };

    const { error } = await client
      .from("money_import_batch_brand_resolutions")
      .delete()
      .eq("batch_id", batchId);

    if (error) {
      throw new Error(error.message || "Failed to delete batch brand resolutions");
    }
  }

  async function updateBatchBrandResolutionSelection(
    resolutionId: string,
    selectedAction: BrandResolutionAction,
    selectedBrandId: string | null,
  ): Promise<void> {
    const client = getAdminClient() as unknown as {
      from: (table: string) => {
        update: (value: Record<string, unknown>) => {
          eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
        };
      };
    };

    const { error } = await client
      .from("money_import_batch_brand_resolutions")
      .update({
        selected_action: selectedAction,
        selected_brand_id: selectedBrandId,
      })
      .eq("id", resolutionId);

    if (error) {
      throw new Error(error.message || "Failed to update batch brand resolution");
    }
  }

  async function findExistingLineItemId(
    transactionId: string,
    importHash: string,
  ): Promise<string | null> {
    const { data, error } = await getAdminClient()
      .from("money_line_items")
      .select("id")
      .eq("transaction_id", transactionId)
      .eq("import_hash", importHash)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return normalizeText((data as Record<string, unknown>).id);
  }

  async function repairExistingTransactionDetails(
    transactionId: string,
    row: CanonicalTransactionRowInput,
  ): Promise<{
    replaced_synthetic_line_items: boolean;
    has_only_synthetic_line_items: boolean;
    has_real_line_items: boolean;
    blocked_by_manual_edit: boolean;
  }> {
    const existingLineItems = await listLineItemsByTransactionIds([transactionId]);
    const normalizedLineItems = existingLineItems.map((lineItem) => ({
      raw_payload:
        lineItem.raw_payload && typeof lineItem.raw_payload === "object"
          ? (lineItem.raw_payload as Record<string, unknown>)
          : null,
      is_placeholder: lineItem.is_placeholder === true,
    }));
    const hasOnlySyntheticLineItems = hasOnlySyntheticImportLineItems(normalizedLineItems);
    const hasRealLineItems = hasRealImportLineItems(normalizedLineItems);

    // A line item a human touched is never replaced by an import. The caller reports the row as
    // skipped, so nothing about this transaction is applied — not the line items, not the header.
    const blockedByManualEdit = existingLineItems.some(
      (lineItem) =>
        lineItem.category_locked_by_user === true ||
        normalizeText(lineItem.assignment_method) === "manual",
    );
    if (blockedByManualEdit) {
      return {
        replaced_synthetic_line_items: false,
        has_only_synthetic_line_items: hasOnlySyntheticLineItems,
        has_real_line_items: hasRealLineItems,
        blocked_by_manual_edit: true,
      };
    }

    // Placeholders are removed unconditionally, not only when every line item is a placeholder.
    // A transaction already damaged by the missing repair call carries a placeholder *next to* the
    // real receipt lines, so the old "all line items are placeholders" condition was false for it
    // and the placeholder would have stayed forever.
    //
    // Balancing lines are removed with them: they are derived from the previous receipt, and a
    // changed receipt must not accumulate stale difference rows.
    const replaceableIds = existingLineItems
      .filter((lineItem) => {
        const rawPayload =
          lineItem.raw_payload && typeof lineItem.raw_payload === "object"
            ? (lineItem.raw_payload as Record<string, unknown>)
            : null;
        const rawSource = normalizeText(rawPayload?.source)?.toLowerCase();
        return (
          lineItem.is_placeholder === true ||
          rawSource === "fallback" ||
          rawSource === "dom_fallback" ||
          rawSource === BALANCING_LINE_ITEM_SOURCE
        );
      })
      .map((lineItem) => normalizeText(lineItem.id))
      .filter((value): value is string => Boolean(value));

    if (replaceableIds.length > 0) {
      const { error: deleteError } = await getAdminClient()
        .from("money_line_items")
        .delete()
        .in("id", replaceableIds);
      if (deleteError) {
        throw new Error(deleteError.message || "Failed to replace synthetic line items");
      }
    }

    const { error: updateError } = await getAdminClient()
      .from("money_transactions")
      .update(
        buildTransactionUpdatePayload(
          row,
        ) as Database["public"]["Tables"]["money_transactions"]["Update"],
      )
      .eq("id", transactionId);
    if (updateError) {
      throw new Error(updateError.message || "Failed to update transaction repair details");
    }

    return {
      replaced_synthetic_line_items: replaceableIds.length > 0,
      has_only_synthetic_line_items: hasOnlySyntheticLineItems,
      has_real_line_items: hasRealLineItems,
      blocked_by_manual_edit: false,
    };
  }

  async function updateExistingTransactionFields(
    transactionId: string,
    row: CanonicalTransactionRowInput,
  ): Promise<void> {
    const { error } = await getAdminClient()
      .from("money_transactions")
      .update(
        buildTransactionUpdatePayload(
          row,
        ) as Database["public"]["Tables"]["money_transactions"]["Update"],
      )
      .eq("id", transactionId);
    if (error) {
      throw new Error(error.message || "Failed to update duplicate transaction");
    }
  }

  async function insertOrResolveTransaction(
    row: CanonicalTransactionRowInput,
    payerPersonId: string,
  ): Promise<{ transactionId: string; inserted: boolean; adopted?: boolean }> {
    // Order matters: exact key, then hash, then adoption, then insert. Adoption has to be tried
    // before the insert, because a statement transaction has no external_id — nothing about the
    // incoming API row conflicts with it, so inserting first would simply create a second copy of
    // the same purchase and double the reported spend.
    const existingId = await findExistingTransactionId(row, payerPersonId);
    if (existingId) {
      await updateExistingTransactionFields(existingId, row);
      return { transactionId: existingId, inserted: false };
    }

    if (row.external_id) {
      const adoption = await findAdoptableTransactionId(row, payerPersonId);
      if (adoption && "ambiguous" in adoption) {
        throw new Error("Multiple statement transactions match this operation");
      }
      if (adoption) {
        await adoptTransaction(adoption.id, row);
        await updateExistingTransactionFields(adoption.id, row);
        return { transactionId: adoption.id, inserted: false, adopted: true };
      }
    }

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

    // A concurrent import inserted the same row between the lookup above and this insert.
    const concurrentId = await findExistingTransactionId(row, payerPersonId);
    if (!concurrentId) {
      throw new Error("Duplicate transaction but existing row could not be resolved");
    }

    await updateExistingTransactionFields(concurrentId, row);
    return { transactionId: concurrentId, inserted: false };
  }

  async function insertLineItemIfNew(
    transactionId: string,
    lineItem: ImportLineItemInput,
    importHash: string,
    fallbackAmount: number,
    isPlaceholder = false,
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
      is_placeholder: isPlaceholder,
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

  async function listReportRowsByBatch(batchId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await getAdminClient()
      .from("money_import_batch_rows")
      .select("*")
      .eq("batch_id", batchId)
      .order("source_row_index", { ascending: true })
      .order("source_line_index", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message || "Failed to load report rows");
    }

    return (data ?? []) as Record<string, unknown>[];
  }

  async function deleteReportRowsByBatch(batchId: string): Promise<void> {
    const { error } = await getAdminClient()
      .from("money_import_batch_rows")
      .delete()
      .eq("batch_id", batchId);

    if (error) {
      throw new Error(error.message || "Failed to delete report rows");
    }
  }

  async function applyCategoryRulePipeline(
    lineItemIds: string[],
    personId: string,
    triggerSource: string,
    forceOverwriteLocked = false,
  ): Promise<Record<string, unknown>> {
    if (lineItemIds.length === 0) {
      return { runs: [], count: 0 };
    }

    if (await hasEnabledLlmCategoryRules(personId)) {
      return await moneyCategorizeRunner({
        lineItemIds,
        personId,
        triggerSource,
        forceOverwriteLocked,
      });
    }

    return await callAdminRpc("money_apply_category_rule_pipeline", {
      p_line_item_ids: lineItemIds,
      p_person_id: personId,
      p_force_overwrite_locked: forceOverwriteLocked,
      p_trigger_source: triggerSource,
    });
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
    getImportBatchForUser,
    updateImportBatch,
    resolveAccountIdForRow,
    resolveCardIdForRow,
    resolveBrandIdForRow,
    previewBrandResolutionForRow,
    upsertBatchBrandResolution,
    getBatchBrandResolutionById,
    listBatchBrandResolutions,
    deleteBatchBrandResolutionsByBatch,
    updateBatchBrandResolutionSelection,
    getExistingTransactionStates,
    findExistingTransactionId,
    findAdoptableTransactionId,
    findExistingLineItemId,
    repairExistingTransactionDetails,
    insertOrResolveTransaction,
    insertLineItemIfNew,
    insertReportRow,
    listReportRowsByBatch,
    deleteReportRowsByBatch,
    applyCategoryRulePipeline,
  };
}
