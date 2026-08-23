import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/database.types.ts";
import {
  BALANCING_LINE_ITEM_SOURCE,
  buildTransactionInsertPayload,
  extractAccountHintFromRow,
  hasOnlySyntheticImportLineItems,
  hasRealImportLineItems,
  isSyntheticImportLineItem,
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

/**
 * How far apart a statement row and the same operation from the bank's API may sit and
 * still be considered the same purchase. A statement distinguishes the operation date from
 * the payment date, and those can be a couple of days apart; three days covers that with
 * room to spare while staying far short of a monthly billing cycle.
 */
export const ADOPTION_WINDOW_HOURS = 72;

export interface MoneyImportRepository {
  authenticateAllowedUser(token: string): Promise<UserAuthContext | null>;
  getSessionByToken(token: string): Promise<Record<string, unknown> | null>;
  getGrantByToken(token: string): Promise<Record<string, unknown> | null>;
  markGrantUsed(grantId: string, usedAtIso: string): Promise<void>;
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

  async function getGrantByToken(token: string): Promise<Record<string, unknown> | null> {
    const tokenHash = await sha256Hex(token);
    const { data, error } = await getAdminClient()
      .from("money_import_grants")
      .select("*")
      .eq("token_hash", tokenHash)
      .single();

    if (error || !data) return null;
    return data as Record<string, unknown>;
  }

  async function markGrantUsed(grantId: string, usedAtIso: string): Promise<void> {
    // Best effort: knowing when a grant was last used is worth having, but failing to
    // record it must not cost the import that is starting.
    await getAdminClient()
      .from("money_import_grants")
      .update({
        last_used_at: usedAtIso,
      } as Database["public"]["Tables"]["money_import_grants"]["Update"])
      .eq("id", grantId);
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
   * Returns the batch only when the caller may act on it. A batch created by someone else
   * reads as missing rather than forbidden, so the answer does not confirm that a batch
   * with that id exists.
   *
   * Batches created before `created_by_auth_user_id` existed carry NULL and stay reachable
   * by any allowed user — the same reach they had before the column was added.
   */
  async function getImportBatchForUser(
    batchId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const batch = await getImportBatch(batchId);
    if (!batch) return null;
    const createdBy = normalizeText(batch.created_by_auth_user_id);
    if (createdBy && createdBy !== userId) return null;
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
    // Both identity keys are scoped to the payer, matching the unique indexes. Without the
    // filter two people importing from the same bank share one namespace, and one person's
    // operation can resolve to the other's row.
    let query = getAdminClient()
      .from("money_transactions")
      .select("id")
      .eq("payer_person_id", payerPersonId)
      .limit(1);
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

  /**
   * Finds a statement transaction that describes the same purchase as an operation coming
   * from the extension.
   *
   * A statement row and an API row never hash alike — the merchant text differs between the
   * two sources — and the statement row has no external id, so neither identity key can
   * match. Without this, loading a statement and then visiting the bank site produces a
   * second copy of every operation and doubles the reported spending.
   *
   * The match is deliberately narrow: same payer, same account, same amount to the kopeck,
   * no external id yet, and posted within ADOPTION_WINDOW_HOURS — wide enough to cover the
   * gap between a statement's operation date and its payment date.
   *
   * When more than one candidate fits, nothing is adopted. Two identical purchases on one
   * day are rare but real, and merging the wrong one loses an operation for good.
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
    if (!Number.isFinite(postedAtMs)) return null;
    const windowMs = ADOPTION_WINDOW_HOURS * 60 * 60 * 1000;

    const { data, error } = await getAdminClient()
      .from("money_transactions")
      .select("id, amount")
      .eq("payer_person_id", payerPersonId)
      .eq("account_id", accountId)
      .is("external_id", null)
      .gte("posted_at", new Date(postedAtMs - windowMs).toISOString())
      .lte("posted_at", new Date(postedAtMs + windowMs).toISOString());
    if (error || !data) return null;

    const candidates = (data as Array<Record<string, unknown>>).filter((candidate) => {
      const candidateAmount = toNumberOrNull(candidate.amount);
      return candidateAmount !== null && Math.abs(candidateAmount - amount) < 0.005;
    });

    if (candidates.length === 0) return null;
    if (candidates.length > 1) return { ambiguous: true };

    const id = normalizeText(candidates[0].id);
    return id ? { id } : null;
  }

  async function listLineItemsByTransactionIds(
    transactionIds: string[],
  ): Promise<Array<Record<string, unknown>>> {
    if (transactionIds.length === 0) return [];
    const { data, error } = await getAdminClient()
      .from("money_line_items")
      .select("transaction_id, raw_payload, is_placeholder")
      .in("transaction_id", transactionIds);
    if (error || !data) return [];
    return data as Array<Record<string, unknown>>;
  }

  /**
   * The repair path needs more than the placeholder probe: it must also see whether a
   * human has touched the existing composition before deleting anything.
   */
  async function listLineItemsForRepair(
    transactionId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const { data, error } = await getAdminClient()
      .from("money_line_items")
      .select(
        "id, transaction_id, raw_payload, is_placeholder, assignment_method, category_locked_by_user",
      )
      .eq("transaction_id", transactionId);
    if (error || !data) return [];
    return data as Array<Record<string, unknown>>;
  }

  function toImportLineItemShape(row: Record<string, unknown>): ImportLineItemInput {
    return {
      raw_payload:
        row.raw_payload && typeof row.raw_payload === "object"
          ? (row.raw_payload as Record<string, unknown>)
          : null,
      is_placeholder: row.is_placeholder === true,
    };
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

    // Third pass: statement rows that describe the same purchase but carry neither key.
    // Without it the extension treats every already-loaded statement operation as new, and
    // never queues it for the receipt it is missing.
    const unmatchedCandidates = candidates.filter((candidate) => {
      const externalId = normalizeText(candidate.external_id);
      const dedupeHash = normalizeText(candidate.dedupe_hash);
      if (externalId && matchesByExternalId.has(externalId)) return false;
      if (dedupeHash && matchesByDedupeHash.has(dedupeHash)) return false;
      return toIsoOrNull(candidate.posted_at) !== null && toNumberOrNull(candidate.amount) !== null;
    });

    const adoptableByCandidateIndex = new Map<number, Record<string, unknown>>();
    if (unmatchedCandidates.length > 0) {
      const windowMs = ADOPTION_WINDOW_HOURS * 60 * 60 * 1000;
      const candidateTimes = unmatchedCandidates
        .map((candidate) => new Date(toIsoOrNull(candidate.posted_at) as string).getTime())
        .filter((value) => Number.isFinite(value));
      const earliest = Math.min(...candidateTimes) - windowMs;
      const latest = Math.max(...candidateTimes) + windowMs;

      const { data } = await getAdminClient()
        .from("money_transactions")
        .select("id, posted_at, amount, receipt_enrichment_status")
        .eq("payer_person_id", payerPersonId)
        .is("external_id", null)
        .gte("posted_at", new Date(earliest).toISOString())
        .lte("posted_at", new Date(latest).toISOString());
      const statementRows = (data ?? []) as Array<Record<string, unknown>>;

      candidates.forEach((candidate, index) => {
        if (!unmatchedCandidates.includes(candidate)) return;
        const candidateMs = new Date(toIsoOrNull(candidate.posted_at) as string).getTime();
        const candidateAmount = toNumberOrNull(candidate.amount);
        if (!Number.isFinite(candidateMs) || candidateAmount === null) return;

        const matches = statementRows.filter((row) => {
          const rowAmount = toNumberOrNull(row.amount);
          const rowMs = new Date(toIsoOrNull(row.posted_at) ?? "").getTime();
          return (
            rowAmount !== null &&
            Number.isFinite(rowMs) &&
            Math.abs(rowAmount - candidateAmount) < 0.005 &&
            Math.abs(rowMs - candidateMs) <= windowMs
          );
        });
        // Ambiguity is reported as "not here yet". The row then travels through the normal
        // import path, which refuses the merge loudly instead of guessing.
        if (matches.length === 1) adoptableByCandidateIndex.set(index, matches[0]);
      });
    }

    const matchedTransactions = Array.from(
      new Set(
        candidates
          .map((candidate, index) => {
            const externalId = normalizeText(candidate.external_id);
            const dedupeHash = normalizeText(candidate.dedupe_hash);
            return (
              (externalId ? matchesByExternalId.get(externalId) : null) ??
              (dedupeHash ? matchesByDedupeHash.get(dedupeHash) : null) ??
              adoptableByCandidateIndex.get(index) ??
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
      existing.push(toImportLineItemShape(row));
      lineItemsByTransactionId.set(transactionId, existing);
    }

    return candidates.map((candidate, index) => {
      const externalId = normalizeText(candidate.external_id);
      const dedupeHash = normalizeText(candidate.dedupe_hash);
      const matchedRow =
        (externalId ? matchesByExternalId.get(externalId) : null) ??
        (dedupeHash ? matchesByDedupeHash.get(dedupeHash) : null) ??
        adoptableByCandidateIndex.get(index) ??
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
    const existingLineItems = await listLineItemsForRepair(transactionId);
    const normalizedLineItems = existingLineItems.map(toImportLineItemShape);
    const hasOnlySyntheticLineItems = hasOnlySyntheticImportLineItems(normalizedLineItems);
    const hasRealLineItems = hasRealImportLineItems(normalizedLineItems);

    // A composition a human has touched is never rebuilt from an import. Losing a manual
    // edit is worse than leaving a visible discrepancy for that transaction.
    const editedByHuman = existingLineItems.some(
      (lineItem) =>
        lineItem.category_locked_by_user === true ||
        normalizeText(lineItem.assignment_method) === "manual",
    );
    if (editedByHuman) {
      return {
        replaced_synthetic_line_items: false,
        has_only_synthetic_line_items: hasOnlySyntheticLineItems,
        has_real_line_items: hasRealLineItems,
        blocked_by_manual_edit: true,
      };
    }

    // Placeholders go unconditionally, not only when every line item is one: a
    // transaction already corrupted by the missing repair call carries a placeholder
    // next to real receipt lines, and an "all synthetic" test would never free it.
    const placeholderIds = existingLineItems
      .filter((lineItem) => isSyntheticImportLineItem(toImportLineItemShape(lineItem)))
      .map((lineItem) => normalizeText(lineItem.id))
      .filter((value): value is string => Boolean(value));

    if (placeholderIds.length > 0) {
      const { error: deleteError } = await getAdminClient()
        .from("money_line_items")
        .delete()
        .in("id", placeholderIds);
      if (deleteError) {
        throw new Error(deleteError.message || "Failed to replace synthetic line items");
      }
    }

    // Balancing rows describe a gap against the previous receipt. A changed receipt
    // gets a freshly computed one, so the stale rows must not pile up.
    const balancingIds = existingLineItems
      .filter(
        (lineItem) =>
          normalizeText(asRecord(lineItem.raw_payload)?.source)?.toLowerCase() ===
          BALANCING_LINE_ITEM_SOURCE,
      )
      .map((lineItem) => normalizeText(lineItem.id))
      .filter((value): value is string => Boolean(value));

    if (balancingIds.length > 0) {
      const { error: deleteError } = await getAdminClient()
        .from("money_line_items")
        .delete()
        .in("id", balancingIds);
      if (deleteError) {
        throw new Error(deleteError.message || "Failed to remove stale balancing line items");
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
      replaced_synthetic_line_items: placeholderIds.length > 0,
      has_only_synthetic_line_items: hasOnlySyntheticLineItems,
      has_real_line_items: hasRealLineItems,
      blocked_by_manual_edit: false,
    };
  }

  async function updateResolvedTransaction(
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
    // Identity is resolved before inserting, in this order: the two exact keys first, then
    // adoption. Adoption cannot be left to the unique-violation path, because an adoptable
    // statement row collides with nothing — the insert would simply succeed and leave two
    // rows describing one purchase.
    const existingId = await findExistingTransactionId(row, payerPersonId);
    if (existingId) {
      await updateResolvedTransaction(existingId, row);
      return { transactionId: existingId, inserted: false };
    }

    if (normalizeText(row.external_id)) {
      const adoptable = await findAdoptableTransactionId(row, payerPersonId);
      if (adoptable && "ambiguous" in adoptable) {
        throw new Error("Multiple statement transactions match this operation");
      }
      if (adoptable) {
        // Taking on the incoming identity keys is what stops the next run from adopting
        // again: from here the operation matches on external_id like any other.
        const { error: adoptError } = await getAdminClient()
          .from("money_transactions")
          .update({
            ...buildTransactionUpdatePayload(row),
            external_id: normalizeText(row.external_id),
            dedupe_hash: normalizeText(row.dedupe_hash),
          } as Database["public"]["Tables"]["money_transactions"]["Update"])
          .eq("id", adoptable.id);
        if (adoptError) {
          throw new Error(adoptError.message || "Failed to adopt statement transaction");
        }
        return { transactionId: adoptable.id, inserted: false, adopted: true };
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

    // A concurrent run inserted the same operation between the lookup and the insert.
    const raced = await findExistingTransactionId(row, payerPersonId);
    if (!raced) {
      throw new Error("Duplicate transaction but existing row could not be resolved");
    }

    await updateResolvedTransaction(raced, row);
    return { transactionId: raced, inserted: false };
  }

  async function insertLineItemIfNew(
    transactionId: string,
    lineItem: ImportLineItemInput,
    importHash: string,
    fallbackAmount: number,
    isPlaceholder?: boolean,
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
      is_placeholder: isPlaceholder ?? isSyntheticImportLineItem(lineItem),
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
    getGrantByToken,
    markGrantUsed,
    findLastImportedAt,
    createImportSession,
    getImportSessionForUser,
    getImportSessionById,
    updateImportSession,
    createImportBatch,
    getImportBatchForUser,
    getImportBatch,
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
