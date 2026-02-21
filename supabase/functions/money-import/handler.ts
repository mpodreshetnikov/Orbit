import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";
import type { Database } from "../_shared/database.types.ts";
import { computeProgressPercent } from "./progress.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const SESSION_TTL_MINUTES = 15;

type RowStatus = "inserted" | "skipped" | "error";

interface ImportLineItemInput {
  title?: string | null;
  amount?: number | null;
  quantity?: number | null;
  unit?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

interface CanonicalTransactionRowInput {
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
  is_transfer?: boolean | null;
  transfer_group_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
  dedupe_hash?: string | null;
  account_id: string;
  card_id?: string | null;
  line_items?: ImportLineItemInput[] | null;
}

interface UserAuthContext {
  mode: "user";
  token: string;
  userId: string;
  email: string | null;
}

interface SessionAuthContext {
  mode: "session";
  token: string;
  session: Record<string, unknown>;
}

type AuthContext = UserAuthContext | SessionAuthContext;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment not configured");
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function createUserAuthClient(token: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase anon environment not configured");
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
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

    const admin = createAdminClient();
    const { data: allowedUser, error: allowlistError } = await admin
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

async function getSessionByToken(
  admin: ReturnType<typeof createAdminClient>,
  token: string,
): Promise<Record<string, unknown> | null> {
  const tokenHash = await sha256Hex(token);
  const { data, error } = await admin
    .from("money_import_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .single();

  if (error || !data) return null;
  return data as Record<string, unknown>;
}

function isSessionUsable(session: Record<string, unknown>): boolean {
  const revokedAt = toIsoOrNull(session.revoked_at);
  if (revokedAt) return false;
  const expiresAt = toIsoOrNull(session.expires_at);
  if (!expiresAt) return false;
  const now = Date.now();
  if (new Date(expiresAt).getTime() <= now) return false;
  const status = normalizeText(session.status) ?? "";
  return ["created", "running"].includes(status);
}

async function resolveAuth(
  req: Request,
  admin: ReturnType<typeof createAdminClient>,
  options: { allowUser: boolean; allowSession: boolean },
): Promise<AuthContext> {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing Authorization header");

  if (options.allowUser) {
    const user = await authenticateAllowedUser(token);
    if (user) return user;
  }

  if (options.allowSession) {
    const session = await getSessionByToken(admin, token);
    if (session && isSessionUsable(session)) {
      return {
        mode: "session",
        token,
        session,
      };
    }
  }

  throw new Error("Unauthorized");
}

async function findLastImportedAt(
  admin: ReturnType<typeof createAdminClient>,
  source: string,
  payerPersonId: string,
): Promise<string | null> {
  const { data, error } = await admin
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

function normalizeSourceForTransactions(source: string): string {
  if (source === "tbank_web") return "tbank";
  return source;
}

function extractAccountHintFromRow(row: CanonicalTransactionRowInput): string | null {
  const rawPayload =
    row.raw_payload && typeof row.raw_payload === "object"
      ? (row.raw_payload as Record<string, unknown>)
      : null;
  const rawHint = normalizeText(rawPayload?.account_hint);
  if (!rawHint) return null;
  const digits = rawHint.replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-4);
}

async function resolveAccountIdForRow(
  admin: ReturnType<typeof createAdminClient>,
  payerPersonId: string,
  row: CanonicalTransactionRowInput,
  fallbackSource: string,
): Promise<string> {
  const explicitAccountId = normalizeText(row.account_id);
  if (explicitAccountId) return explicitAccountId;

  const sourceForAccounts = normalizeSourceForTransactions(
    normalizeText(row.source) ?? fallbackSource,
  );

  const { data: accounts, error: accountsError } = await admin
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
    const { data: cards, error: cardsError } = await admin
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

  if (accountIds.length === 1) {
    return accountIds[0];
  }

  throw new Error("account_id is required and could not be resolved");
}

function normalizeLineItems(row: CanonicalTransactionRowInput): ImportLineItemInput[] {
  if (Array.isArray(row.line_items) && row.line_items.length > 0) {
    return row.line_items;
  }
  return [
    {
      title: row.merchant_name || "Imported",
      amount: row.amount,
      raw_payload: row.raw_payload ?? null,
    },
  ];
}

function normalizeTransactionRow(
  row: CanonicalTransactionRowInput,
  fallbackSource: string,
): CanonicalTransactionRowInput {
  const source = normalizeText(row.source) ?? fallbackSource;
  const currency = normalizeText(row.currency) ?? "RUB";
  const status = normalizeText(row.status) ?? "posted";
  const transactionType = normalizeText(row.transaction_type) ?? "expense";
  const postedAtIso = toIsoOrNull(row.posted_at);
  if (!postedAtIso) {
    throw new Error("Invalid posted_at");
  }
  const amount = toNumberOrNull(row.amount);
  if (amount === null) {
    throw new Error("Invalid amount");
  }

  return {
    ...row,
    source,
    currency,
    status,
    transaction_type: transactionType,
    posted_at: postedAtIso,
    amount,
    external_id: normalizeText(row.external_id),
    merchant_name: normalizeText(row.merchant_name),
    mcc: normalizeText(row.mcc),
    comment: normalizeText(row.comment),
    transfer_group_id: normalizeText(row.transfer_group_id),
    dedupe_hash: normalizeText(row.dedupe_hash),
    card_id: normalizeText(row.card_id),
    account_id: normalizeText(row.account_id) ?? "",
    line_items: normalizeLineItems(row),
  };
}

function buildTransactionInsertPayload(
  row: CanonicalTransactionRowInput,
  payerPersonId: string,
): Record<string, unknown> {
  return {
    payer_person_id: payerPersonId,
    account_id: row.account_id,
    card_id: row.card_id ?? null,
    source: row.source ?? "manual",
    external_id: row.external_id ?? null,
    posted_at: row.posted_at,
    amount: row.amount,
    currency: row.currency ?? "RUB",
    transaction_type: row.transaction_type,
    status: row.status ?? "posted",
    merchant_name: row.merchant_name ?? null,
    mcc: row.mcc ?? null,
    comment: row.comment ?? null,
    is_transfer: row.is_transfer ?? false,
    transfer_group_id: row.transfer_group_id ?? null,
    raw_payload: row.raw_payload ?? null,
    dedupe_hash: row.dedupe_hash ?? null,
  };
}

async function findExistingTransactionId(
  admin: ReturnType<typeof createAdminClient>,
  row: CanonicalTransactionRowInput,
): Promise<string | null> {
  let query = admin.from("money_transactions").select("id").limit(1);
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

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "23505";
}

async function insertOrResolveTransaction(
  admin: ReturnType<typeof createAdminClient>,
  row: CanonicalTransactionRowInput,
  payerPersonId: string,
): Promise<{ transactionId: string; inserted: boolean }> {
  const payload = buildTransactionInsertPayload(row, payerPersonId);
  const { data, error } = await admin
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

  const existingId = await findExistingTransactionId(admin, row);
  if (!existingId) {
    throw new Error("Duplicate transaction but existing row could not be resolved");
  }

  return {
    transactionId: existingId,
    inserted: false,
  };
}

function buildLineItemImportHash(
  txIdentity: string,
  lineItem: ImportLineItemInput,
  lineIndex: number,
): Promise<string> {
  const payload = {
    txIdentity,
    lineIndex,
    title: normalizeText(lineItem.title) ?? "Imported",
    amount: toNumberOrNull(lineItem.amount) ?? 0,
    quantity: toNumberOrNull(lineItem.quantity),
    unit: normalizeText(lineItem.unit),
    raw_payload: lineItem.raw_payload ?? null,
  };

  return sha256Hex(JSON.stringify(payload));
}

async function insertLineItemIfNew(
  admin: ReturnType<typeof createAdminClient>,
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
    raw_payload: lineItem.raw_payload ?? null,
    import_hash: importHash,
  };

  const { data, error } = await admin
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

  const { data: existing } = await admin
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

async function createBatchRow(
  admin: ReturnType<typeof createAdminClient>,
  payload: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin
    .from("money_import_batches")
    .insert(payload as Database["public"]["Tables"]["money_import_batches"]["Insert"])
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create import batch");
  }

  return (data as Record<string, unknown>).id as string;
}

async function insertReportRow(
  admin: ReturnType<typeof createAdminClient>,
  payload: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin
    .from("money_import_batch_rows")
    .insert(payload as Database["public"]["Tables"]["money_import_batch_rows"]["Insert"])
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to insert report row");
  }

  return (data as Record<string, unknown>).id as string;
}

async function createSessionAction(
  body: Record<string, unknown>,
  auth: UserAuthContext,
  admin: ReturnType<typeof createAdminClient>,
): Promise<Response> {
  const source = normalizeText(body.source);
  const payerPersonId = normalizeText(body.payer_person_id);
  if (!source || !payerPersonId) {
    return jsonResponse({ error: "source and payer_person_id are required" }, 400);
  }

  const windowFrom = toIsoOrNull(body.window_from);
  const windowTo = toIsoOrNull(body.window_to);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();

  const token = randomSessionToken();
  const tokenHash = await sha256Hex(token);

  const { data: sessionRow, error: sessionError } = await admin
    .from("money_import_sessions")
    .insert({
      token_hash: tokenHash,
      source,
      payer_person_id: payerPersonId,
      created_by_auth_user_id: auth.userId,
      status: "created",
      window_from: windowFrom,
      window_to: windowTo,
      expires_at: expiresAt,
      meta: (body.meta ??
        null) as Database["public"]["Tables"]["money_import_sessions"]["Insert"]["meta"],
    })
    .select("id")
    .single();

  if (sessionError || !sessionRow) {
    return jsonResponse({ error: sessionError?.message || "Failed to create import session" }, 400);
  }

  const sessionId = (sessionRow as Record<string, unknown>).id as string;

  const batchId = await createBatchRow(admin, {
    source,
    payer_person_id: payerPersonId,
    import_type: "web_export",
    file_path: null,
    meta: body.meta ?? null,
    session_id: sessionId,
    status: "running",
    window_from: windowFrom,
    window_to: windowTo,
  });

  await admin
    .from("money_import_sessions")
    .update({
      batch_id: batchId,
      status: "running",
      window_from: windowFrom,
      window_to: windowTo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  const lastImportedAt = await findLastImportedAt(
    admin,
    normalizeSourceForTransactions(source),
    payerPersonId,
  );

  return jsonResponse({
    session_id: sessionId,
    session_token: token,
    batch_id: batchId,
    source,
    payer_person_id: payerPersonId,
    expires_at: expiresAt,
    last_imported_at: lastImportedAt,
    ttl_minutes: SESSION_TTL_MINUTES,
  });
}

async function sessionStatusAction(
  body: Record<string, unknown>,
  auth: UserAuthContext,
  admin: ReturnType<typeof createAdminClient>,
): Promise<Response> {
  const sessionId = normalizeText(body.session_id);
  if (!sessionId) {
    return jsonResponse({ error: "session_id is required" }, 400);
  }

  const { data: session, error: sessionError } = await admin
    .from("money_import_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("created_by_auth_user_id", auth.userId)
    .single();

  if (sessionError || !session) {
    return jsonResponse({ error: "Session not found" }, 404);
  }

  const batchId = normalizeText((session as Record<string, unknown>).batch_id);
  let batch: Record<string, unknown> | null = null;
  if (batchId) {
    const { data: batchData } = await admin
      .from("money_import_batches")
      .select("*")
      .eq("id", batchId)
      .single();
    batch = (batchData as Record<string, unknown>) ?? null;
  }

  const windowSource = (batch ?? (session as Record<string, unknown>)) as Record<string, unknown>;
  const windowFrom = toIsoOrNull(windowSource.window_from);
  const windowTo = toIsoOrNull(windowSource.window_to);
  const parsedThrough = toIsoOrNull((batch ?? {}).parsed_through_at);

  const progressPercent = computeProgressPercent(windowFrom, windowTo, parsedThrough);

  return jsonResponse({
    session: {
      id: (session as Record<string, unknown>).id,
      source: (session as Record<string, unknown>).source,
      payer_person_id: (session as Record<string, unknown>).payer_person_id,
      status: (session as Record<string, unknown>).status,
      expires_at: (session as Record<string, unknown>).expires_at,
      revoked_at: (session as Record<string, unknown>).revoked_at,
      window_from: windowFrom,
      window_to: windowTo,
      batch_id: batchId,
    },
    batch: batch
      ? {
          id: batch.id,
          status: batch.status,
          parsed_transactions_count: batch.parsed_transactions_count,
          parsed_through_at: batch.parsed_through_at,
          inserted_count: batch.inserted_count,
          skipped_count: batch.skipped_count,
          error_count: batch.error_count,
          completed_at: batch.completed_at,
          window_from: batch.window_from,
          window_to: batch.window_to,
          progress_percent: progressPercent,
        }
      : null,
  });
}

async function applyRowsAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  admin: ReturnType<typeof createAdminClient>,
): Promise<Response> {
  const rowsRaw = body.rows;
  if (!Array.isArray(rowsRaw)) {
    return jsonResponse({ error: "rows must be an array" }, 400);
  }

  let source = normalizeText(body.source) ?? "manual";
  let payerPersonId = normalizeText(body.payer_person_id);
  let importType = normalizeText(body.import_type) ?? "file";
  let batchId = normalizeText(body.batch_id);
  let sessionId = normalizeText(body.session_id);

  if (auth.mode === "session") {
    const session = auth.session;
    const sessionStatus = normalizeText(session.status) ?? "";
    if (!isSessionUsable(session)) {
      return jsonResponse({ error: "Import session expired or revoked" }, 401);
    }

    source = normalizeText(session.source) ?? source;
    payerPersonId = normalizeText(session.payer_person_id) ?? payerPersonId;
    batchId = normalizeText(session.batch_id) ?? batchId;
    sessionId = normalizeText(session.id) ?? sessionId;
    importType = "web_export";

    if (sessionStatus === "created" && sessionId) {
      await admin
        .from("money_import_sessions")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", sessionId);
    }
  }

  if (!payerPersonId) {
    return jsonResponse({ error: "payer_person_id is required" }, 400);
  }

  const transactionSourceFallback = normalizeSourceForTransactions(source);

  if (!batchId) {
    batchId = await createBatchRow(admin, {
      source,
      payer_person_id: payerPersonId,
      import_type: importType,
      file_path: normalizeText(body.file_path),
      meta: body.meta ?? null,
      session_id: sessionId,
      status: "running",
      window_from: toIsoOrNull(body.window_from),
      window_to: toIsoOrNull(body.window_to),
    });

    if (sessionId) {
      await admin
        .from("money_import_sessions")
        .update({ batch_id: batchId, updated_at: new Date().toISOString() })
        .eq("id", sessionId);
    }
  }

  const { data: batchBefore, error: batchBeforeError } = await admin
    .from("money_import_batches")
    .select("*")
    .eq("id", batchId)
    .single();

  if (batchBeforeError || !batchBefore) {
    return jsonResponse({ error: "Batch not found" }, 404);
  }

  let insertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const rowResults: Array<Record<string, unknown>> = [];
  const accountResolutionCache = new Map<string, string>();

  for (let rowIndex = 0; rowIndex < rowsRaw.length; rowIndex++) {
    const raw = rowsRaw[rowIndex] as CanonicalTransactionRowInput;

    try {
      const explicitAccountId = normalizeText(raw.account_id);
      const accountHint = extractAccountHintFromRow(raw);
      const rowSource = normalizeSourceForTransactions(
        normalizeText(raw.source) ?? transactionSourceFallback,
      );
      const accountCacheKey = explicitAccountId
        ? `explicit:${explicitAccountId}`
        : `${rowSource}|${accountHint ?? "none"}`;

      let resolvedAccountId = accountResolutionCache.get(accountCacheKey) ?? null;
      if (!resolvedAccountId) {
        resolvedAccountId = await resolveAccountIdForRow(
          admin,
          payerPersonId,
          raw,
          transactionSourceFallback,
        );
        accountResolutionCache.set(accountCacheKey, resolvedAccountId);
      }

      const normalized = normalizeTransactionRow(
        {
          ...raw,
          account_id: resolvedAccountId,
        },
        transactionSourceFallback,
      );
      const tx = await insertOrResolveTransaction(admin, normalized, payerPersonId);

      const txStatus: RowStatus = tx.inserted ? "inserted" : "skipped";
      const txMessage = tx.inserted ? null : "Duplicate transaction";

      if (txStatus === "inserted") insertedCount++;
      if (txStatus === "skipped") skippedCount++;

      const txReportRowId = await insertReportRow(admin, {
        batch_id: batchId,
        parent_row_id: null,
        row_kind: "transaction",
        source_row_index: rowIndex,
        source_line_index: null,
        status: txStatus,
        message: txMessage,
        transaction_id: tx.transactionId,
        line_item_id: null,
        payload: normalized,
      });

      const lineItems = normalizeLineItems(normalized);
      const lineResults: Array<Record<string, unknown>> = [];

      for (let lineIndex = 0; lineIndex < lineItems.length; lineIndex++) {
        const lineItem = lineItems[lineIndex];
        try {
          const importHash = await buildLineItemImportHash(tx.transactionId, lineItem, lineIndex);
          const lineRes = await insertLineItemIfNew(
            admin,
            tx.transactionId,
            lineItem,
            importHash,
            normalized.amount,
          );

          const lineStatus: RowStatus = lineRes.inserted ? "inserted" : "skipped";
          const lineMessage = lineRes.inserted ? null : "Duplicate line item";

          await insertReportRow(admin, {
            batch_id: batchId,
            parent_row_id: txReportRowId,
            row_kind: "line_item",
            source_row_index: rowIndex,
            source_line_index: lineIndex,
            status: lineStatus,
            message: lineMessage,
            transaction_id: tx.transactionId,
            line_item_id: lineRes.lineItemId,
            payload: {
              ...lineItem,
              import_hash: importHash,
            },
          });

          lineResults.push({
            line_index: lineIndex,
            status: lineStatus,
            message: lineMessage,
            line_item_id: lineRes.lineItemId,
          });
        } catch (lineError) {
          const lineMessage =
            lineError instanceof Error ? lineError.message : "Line item import failed";
          errorCount++;
          await insertReportRow(admin, {
            batch_id: batchId,
            parent_row_id: txReportRowId,
            row_kind: "line_item",
            source_row_index: rowIndex,
            source_line_index: lineIndex,
            status: "error",
            message: lineMessage,
            transaction_id: tx.transactionId,
            line_item_id: null,
            payload: lineItem,
          });

          lineResults.push({
            line_index: lineIndex,
            status: "error",
            message: lineMessage,
            line_item_id: null,
          });
        }
      }

      rowResults.push({
        idx: rowIndex,
        status: txStatus,
        message: txMessage,
        transaction_id: tx.transactionId,
        line_results: lineResults,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import row failed";
      errorCount++;

      await insertReportRow(admin, {
        batch_id: batchId,
        parent_row_id: null,
        row_kind: "transaction",
        source_row_index: rowIndex,
        source_line_index: null,
        status: "error",
        message,
        transaction_id: null,
        line_item_id: null,
        payload: rowsRaw[rowIndex] as Record<string, unknown>,
      });

      rowResults.push({
        idx: rowIndex,
        status: "error",
        message,
        transaction_id: null,
      });
    }
  }

  const parsedCountInput = toNumberOrNull(body.parsed_transactions_count);
  const parsedThroughInput = toIsoOrNull(body.parsed_through_at);
  const windowFromInput = toIsoOrNull(body.window_from);
  const windowToInput = toIsoOrNull(body.window_to);

  const previousParsedCount =
    toNumberOrNull((batchBefore as Record<string, unknown>).parsed_transactions_count) ?? 0;
  const parsedTransactionsCount =
    parsedCountInput !== null
      ? Math.max(previousParsedCount, parsedCountInput)
      : previousParsedCount + rowsRaw.length;

  const existingInserted =
    toNumberOrNull((batchBefore as Record<string, unknown>).inserted_count) ?? 0;
  const existingSkipped =
    toNumberOrNull((batchBefore as Record<string, unknown>).skipped_count) ?? 0;
  const existingError = toNumberOrNull((batchBefore as Record<string, unknown>).error_count) ?? 0;

  const nextInserted = existingInserted + insertedCount;
  const nextSkipped = existingSkipped + skippedCount;
  const nextError = existingError + errorCount;

  const parsedThrough =
    parsedThroughInput ??
    (rowsRaw.length > 0
      ? (rowsRaw
          .map((r) => toIsoOrNull((r as CanonicalTransactionRowInput).posted_at))
          .filter((v): v is string => Boolean(v))
          .sort()[0] ?? null)
      : null);

  const patch: Record<string, unknown> = {
    parsed_transactions_count: parsedTransactionsCount,
    inserted_count: nextInserted,
    skipped_count: nextSkipped,
    error_count: nextError,
  };

  const isSessionFlow = Boolean(sessionId);
  const shouldAutoComplete = !isSessionFlow && importType === "file";
  patch.status = shouldAutoComplete ? "completed" : "running";
  if (shouldAutoComplete) {
    patch.completed_at = new Date().toISOString();
  }

  if (parsedThrough) patch.parsed_through_at = parsedThrough;
  if (windowFromInput) patch.window_from = windowFromInput;
  if (windowToInput) patch.window_to = windowToInput;

  const { error: updateBatchError } = await admin
    .from("money_import_batches")
    .update(patch)
    .eq("id", batchId);

  if (updateBatchError) {
    return jsonResponse({ error: updateBatchError.message }, 400);
  }

  if (sessionId) {
    const sessionPatch: Record<string, unknown> = {
      status: "running",
      updated_at: new Date().toISOString(),
    };
    if (windowFromInput) sessionPatch.window_from = windowFromInput;
    if (windowToInput) sessionPatch.window_to = windowToInput;

    await admin.from("money_import_sessions").update(sessionPatch).eq("id", sessionId);
  }

  return jsonResponse({
    batch_id: batchId,
    inserted: insertedCount,
    skipped: skippedCount,
    error_count: errorCount,
    row_results: rowResults,
  });
}

async function completeSessionAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  admin: ReturnType<typeof createAdminClient>,
): Promise<Response> {
  let sessionId = normalizeText(body.session_id);
  let batchId = normalizeText(body.batch_id);

  if (auth.mode === "session") {
    sessionId = normalizeText(auth.session.id) ?? sessionId;
    batchId = normalizeText(auth.session.batch_id) ?? batchId;
  }

  if (!sessionId) {
    return jsonResponse({ error: "session_id is required" }, 400);
  }

  const desiredStatus = normalizeText(body.status);
  const finalStatus = desiredStatus === "failed" ? "failed" : "completed";
  const batchStatus = finalStatus === "failed" ? "failed" : "completed";

  const sessionWhere = admin
    .from("money_import_sessions")
    .update({
      status: finalStatus,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (auth.mode === "user") {
    sessionWhere.eq("created_by_auth_user_id", auth.userId);
  }

  const { error: sessionError } = await sessionWhere;
  if (sessionError) {
    return jsonResponse({ error: sessionError.message }, 400);
  }

  if (batchId) {
    const { error: batchError } = await admin
      .from("money_import_batches")
      .update({
        status: batchStatus,
        completed_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    if (batchError) {
      return jsonResponse({ error: batchError.message }, 400);
    }
  }

  return jsonResponse({
    session_id: sessionId,
    batch_id: batchId,
    status: finalStatus,
  });
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const admin = createAdminClient();
    const body = (await req.json()) as Record<string, unknown>;
    const action = normalizeText(body.action);

    if (!action) {
      return jsonResponse({ error: "action is required" }, 400);
    }

    if (action === "create_session") {
      const auth = await resolveAuth(req, admin, { allowUser: true, allowSession: false });
      if (auth.mode !== "user") return jsonResponse({ error: "Unauthorized" }, 401);
      return await createSessionAction(body, auth, admin);
    }

    if (action === "session_status") {
      const auth = await resolveAuth(req, admin, { allowUser: true, allowSession: false });
      if (auth.mode !== "user") return jsonResponse({ error: "Unauthorized" }, 401);
      return await sessionStatusAction(body, auth, admin);
    }

    if (action === "apply_rows") {
      const auth = await resolveAuth(req, admin, { allowUser: true, allowSession: true });
      return await applyRowsAction(body, auth, admin);
    }

    if (action === "complete_session") {
      const auth = await resolveAuth(req, admin, { allowUser: true, allowSession: true });
      return await completeSessionAction(body, auth, admin);
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" || message.includes("Authorization") ? 401 : 400;
    return jsonResponse({ error: message }, status);
  }
}
