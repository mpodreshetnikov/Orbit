import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../_shared/database.types.ts";
import type {
  MoneyCategorizeRepository,
  MoneyCategory,
  MoneyCategoryRule,
  MoneyCategoryRuleContext,
  MoneyCategoryRuleRunResult,
} from "./service.ts";

export interface MoneyCategorizeRepositoryConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  createClientFn?: typeof createClient;
}

function safeEnvGet(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asString(value: unknown): string | null {
  return normalizeText(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

type UntypedSelectListResult = Promise<{
  data: Record<string, unknown>[] | null;
  error: { message?: string } | null;
}>;

type UntypedSelectSingleResult = Promise<{
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
}>;

interface UntypedSelectQuery extends PromiseLike<Awaited<UntypedSelectListResult>> {
  eq(column: string, value: unknown): UntypedSelectQuery;
  in(column: string, values: unknown[]): UntypedSelectQuery;
  is(column: string, value: unknown): UntypedSelectQuery;
  order(column: string, options?: { ascending?: boolean }): UntypedSelectQuery;
  limit(value: number): UntypedSelectQuery;
  single(): UntypedSelectSingleResult;
  maybeSingle(): UntypedSelectSingleResult;
}

interface UntypedMutationQuery extends PromiseLike<{
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
}> {
  eq(column: string, value: unknown): UntypedMutationQuery;
  in(column: string, values: unknown[]): UntypedMutationQuery;
  select(columns?: string): UntypedMutationQuery;
  single(): UntypedSelectSingleResult;
}

function rowToRule(row: Record<string, unknown>): MoneyCategoryRule {
  return {
    id: String(row.id),
    person_id: String(row.person_id),
    name: String(row.name ?? ""),
    description: (row.description as string | null) ?? null,
    enabled: Boolean(row.enabled),
    sort_order: Number(row.sort_order ?? 0),
    rule_kind: row.rule_kind as MoneyCategoryRule["rule_kind"],
    target_category_id: (row.target_category_id as string | null) ?? null,
    match_mode: (row.match_mode as MoneyCategoryRule["match_mode"]) ?? "all",
    scope_filter: (row.scope_filter as MoneyCategoryRule["scope_filter"]) ?? "all_line_items",
    filters: Array.isArray(row.filters) ? (row.filters as MoneyCategoryRule["filters"]) : [],
    config: (row.config as Record<string, unknown> | null) ?? {},
    stop_processing: Boolean(row.stop_processing),
    created_at: (row.created_at as string | null) ?? null,
  };
}

function rowToCategory(row: Record<string, unknown>): MoneyCategory {
  return {
    id: String(row.id),
    parent_id: (row.parent_id as string | null) ?? null,
    canonical_category_id: String(row.canonical_category_id ?? row.id),
    category_kind: (row.category_kind as MoneyCategory["category_kind"]) ?? "custom",
    system_key: (row.system_key as string | null) ?? null,
    sort_order: Number(row.sort_order ?? 0),
    created_by: (row.created_by as string | null) ?? null,
    depth: Number(row.depth ?? 1),
    name_en: String(row.name_en ?? ""),
    name_ru: String(row.name_ru ?? ""),
    slug: String(row.slug ?? ""),
    archived_at: (row.archived_at as string | null) ?? null,
  };
}

function asRuleStep(raw: Record<string, unknown>) {
  return {
    step_id: (raw.step_id as string | null) ?? (raw.id as string | null) ?? null,
    rule_id: String(raw.rule_id ?? ""),
    rule_name: String(raw.rule_name ?? ""),
    rule_kind: raw.rule_kind as MoneyCategoryRule["rule_kind"],
    sort_order: Number(raw.sort_order ?? 0),
    matched: Boolean(raw.matched),
    changed_category: Boolean(raw.changed_category),
    previous_category_id: (raw.previous_category_id as string | null) ?? null,
    next_category_id: (raw.next_category_id as string | null) ?? null,
    decision_reason: String(raw.decision_reason ?? ""),
    debug_payload: (raw.debug_payload as Record<string, unknown> | null) ?? {},
  };
}

function asRunResult(raw: Record<string, unknown>): MoneyCategoryRuleRunResult {
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  return {
    run_id: (raw.run_id as string | null) ?? (raw.id as string | null) ?? null,
    line_item_id: String(raw.line_item_id ?? ""),
    line_item_title: (raw.line_item_title as string | null) ?? null,
    transaction_id: String(raw.transaction_id ?? ""),
    merchant_name: (raw.merchant_name as string | null) ?? null,
    person_id: String(raw.person_id ?? ""),
    trigger_source: String(raw.trigger_source ?? ""),
    starting_category_id: (raw.starting_category_id as string | null) ?? null,
    final_category_id: (raw.final_category_id as string | null) ?? null,
    saved: Boolean(raw.saved),
    llm_tokens_prompt: raw.llm_tokens_prompt == null ? null : Number(raw.llm_tokens_prompt),
    llm_tokens_completion:
      raw.llm_tokens_completion == null ? null : Number(raw.llm_tokens_completion),
    decision_reason: (raw.decision_reason as string | null) ?? null,
    steps: stepsRaw.map((step: unknown) => asRuleStep(asRecord(step))),
  };
}

function asRunEnvelope(raw: unknown): { runs: MoneyCategoryRuleRunResult[]; count: number } {
  const record = asRecord(raw);
  const runsRaw = Array.isArray(record.runs) ? record.runs : [];
  const runs = runsRaw.map((run: unknown) => asRunResult(asRecord(run)));
  return {
    runs,
    count: Number(record.count ?? runs.length),
  };
}

export function createSupabaseMoneyCategorizeRepository(
  config: MoneyCategorizeRepositoryConfig = {},
): MoneyCategorizeRepository & {
  authenticateAllowedUser(token: string): Promise<{ userId: string; email: string | null } | null>;
} {
  const createClientFn = config.createClientFn ?? createClient;
  const supabaseUrl = config.supabaseUrl ?? safeEnvGet("SUPABASE_URL");
  const supabaseAnonKey = config.supabaseAnonKey ?? safeEnvGet("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey =
    config.supabaseServiceRoleKey ?? safeEnvGet("SUPABASE_SERVICE_ROLE_KEY");

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

  function getUntypedAdminClient() {
    return getAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => UntypedSelectQuery;
        insert: (value: Record<string, unknown>) => UntypedMutationQuery;
        update: (value: Record<string, unknown>) => UntypedMutationQuery;
      };
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
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

  async function callRpc(functionName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = getAdminClient() as unknown as {
      rpc: (
        name: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    const { data, error } = await client.rpc(functionName, args);
    if (error) throw new Error(error.message || `Failed to call ${functionName}`);
    return data;
  }

  async function authenticateAllowedUser(token: string) {
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
      return { userId: user.id, email: user.email ?? null };
    } catch {
      return null;
    }
  }

  async function listRules(
    personId: string,
    ruleIds?: string[] | null,
  ): Promise<MoneyCategoryRule[]> {
    let query = getUntypedAdminClient()
      .from("money_category_rules")
      .select("*")
      .eq("person_id", personId)
      .eq("enabled", true);

    if (ruleIds && ruleIds.length > 0) {
      query = query.in("id", ruleIds);
    }

    const { data, error } = await query
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row: unknown) => rowToRule(asRecord(row)));
  }

  async function getLineItemContext(
    lineItemId: string,
    personId?: string | null,
  ): Promise<MoneyCategoryRuleContext | null> {
    const data = await callRpc("money_get_category_rule_context", {
      p_line_item_id: lineItemId,
      p_person_id: personId ?? undefined,
    });
    const record = asRecord(data);
    return Object.keys(record).length === 0
      ? null
      : (record as unknown as MoneyCategoryRuleContext);
  }

  async function listCategories(): Promise<MoneyCategory[]> {
    const { data, error } = await getAdminClient()
      .from("money_categories")
      .select("*")
      .order("category_kind", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("depth", { ascending: true })
      .order("name_en", { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row: unknown) => rowToCategory(asRecord(row)));
  }

  async function findMccCanonicalCategoryId(mcc: string): Promise<string | null> {
    const { data, error } = await getUntypedAdminClient()
      .from("money_mcc_canonical_category_map")
      .select("canonical_category_id")
      .eq("mcc", mcc)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return asString(asRecord(data).canonical_category_id);
  }

  async function createRuleRun(payload: Record<string, unknown>): Promise<string> {
    const { data, error } = await getUntypedAdminClient()
      .from("money_category_rule_runs")
      .insert(payload)
      .select("id")
      .single();

    if (error || !data) throw new Error(error?.message || "Failed to create rule run");
    return String(asRecord(data).id);
  }

  async function createRuleRunStep(payload: Record<string, unknown>): Promise<string> {
    const { data, error } = await getUntypedAdminClient()
      .from("money_category_rule_run_steps")
      .insert(payload)
      .select("id")
      .single();

    if (error || !data) throw new Error(error?.message || "Failed to create rule run step");
    return String(asRecord(data).id);
  }

  async function finalizeRuleRun(payload: Record<string, unknown>): Promise<void> {
    const runId = String(payload.run_id);
    const { error: runUpdateError } = await getUntypedAdminClient()
      .from("money_category_rule_runs")
      .update({
        final_category_id: asString(payload.final_category_id),
        saved: Boolean(payload.saved),
        llm_tokens_prompt: asNumber(payload.llm_tokens_prompt),
        llm_tokens_completion: asNumber(payload.llm_tokens_completion),
      })
      .eq("id", runId);

    if (runUpdateError) throw new Error(runUpdateError.message);
    if (!payload.saved) return;

    const { data: runRow, error: runReadError } = await getUntypedAdminClient()
      .from("money_category_rule_runs")
      .select("line_item_id")
      .eq("id", runId)
      .limit(1)
      .single();
    if (runReadError || !runRow) {
      throw new Error(runReadError?.message || "Failed to read finalized rule run");
    }

    const lineItemId = String(asRecord(runRow).line_item_id);
    const { error: lineItemUpdateError } = await getUntypedAdminClient()
      .from("money_line_items")
      .update({
        category_id: asString(payload.final_category_id),
        assignment_method: asString(payload.last_assignment_method) ?? "rule",
        assignment_rule_id: asString(payload.last_changed_rule_id),
        last_category_rule_id: asString(payload.last_changed_rule_id),
        last_category_rule_run_id: runId,
        category_assigned_at: new Date().toISOString(),
      })
      .eq("id", lineItemId);

    if (lineItemUpdateError) throw new Error(lineItemUpdateError.message);
  }

  async function listLineItemIdsForTransaction(transactionId: string): Promise<string[]> {
    const { data, error } = await getAdminClient()
      .from("money_line_items")
      .select("id")
      .eq("transaction_id", transactionId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row: unknown) => String(asRecord(row).id));
  }

  async function listLineItemIdsForDateRange(
    personId: string,
    from: string,
    to: string,
  ): Promise<string[]> {
    const { data: txRows, error: txError } = await getAdminClient()
      .from("money_transactions")
      .select("id,posted_at")
      .eq("payer_person_id", personId)
      .gte("posted_at", `${from}T00:00:00`)
      .lte("posted_at", `${to}T23:59:59.999999`);

    if (txError) throw new Error(txError.message);
    const transactionIds = (txRows ?? []).map((row: unknown) => String(asRecord(row).id));
    const postedAtByTransactionId = new Map(
      (txRows ?? []).map((row: unknown) => [
        String(asRecord(row).id),
        String(asRecord(row).posted_at ?? ""),
      ]),
    );
    if (transactionIds.length === 0) return [];

    const { data: lineItemRows, error: lineItemError } = await getAdminClient()
      .from("money_line_items")
      .select("id,transaction_id,created_at")
      .in("transaction_id", transactionIds);

    if (lineItemError) throw new Error(lineItemError.message);

    return (lineItemRows ?? [])
      .slice()
      .sort((left, right) => {
        const leftTxId = String(asRecord(left).transaction_id ?? "");
        const rightTxId = String(asRecord(right).transaction_id ?? "");
        const txCompare = (postedAtByTransactionId.get(leftTxId) ?? "").localeCompare(
          postedAtByTransactionId.get(rightTxId) ?? "",
        );
        if (txCompare !== 0) return txCompare;
        return String(asRecord(left).id ?? "").localeCompare(String(asRecord(right).id ?? ""));
      })
      .map((row: unknown) => String(asRecord(row).id));
  }

  async function runDeterministicPreview(input: {
    lineItemId: string;
    personId?: string | null;
    ruleIds?: string[] | null;
  }): Promise<MoneyCategoryRuleRunResult> {
    const data = await callRpc("money_preview_category_rule_pipeline", {
      p_line_item_id: input.lineItemId,
      p_person_id: input.personId ?? undefined,
      p_rule_ids: input.ruleIds ?? undefined,
    });
    return asRunResult(asRecord(data));
  }

  async function runDeterministicApplyLineItems(input: {
    lineItemIds: string[];
    personId: string;
    forceOverwriteLocked: boolean;
    triggerSource: string;
  }): Promise<{ runs: MoneyCategoryRuleRunResult[]; count: number }> {
    const data = await callRpc("money_apply_category_rule_pipeline", {
      p_line_item_ids: input.lineItemIds,
      p_person_id: input.personId,
      p_force_overwrite_locked: input.forceOverwriteLocked,
      p_trigger_source: input.triggerSource,
    });
    return asRunEnvelope(data);
  }

  async function runDeterministicReplayTransaction(input: {
    transactionId: string;
    personId?: string | null;
    forceOverwriteLocked: boolean;
  }): Promise<{ runs: MoneyCategoryRuleRunResult[]; count: number }> {
    const data = await callRpc("money_apply_category_rule_pipeline_for_transaction", {
      p_transaction_id: input.transactionId,
      p_person_id: input.personId ?? undefined,
      p_force_overwrite_locked: input.forceOverwriteLocked,
    });
    return asRunEnvelope(data);
  }

  async function runDeterministicReplayDateRange(input: {
    personId: string;
    from: string;
    to: string;
    forceOverwriteLocked: boolean;
  }): Promise<{ runs: MoneyCategoryRuleRunResult[]; count: number }> {
    const data = await callRpc("money_apply_category_rule_pipeline_for_date_range", {
      p_person_id: input.personId,
      p_from: input.from,
      p_to: input.to,
      p_force_overwrite_locked: input.forceOverwriteLocked,
    });
    return asRunEnvelope(data);
  }

  async function updateRunsTriggeredByUser(
    runIds: string[],
    triggeredByUserId: string,
  ): Promise<void> {
    if (runIds.length === 0) return;
    const { error } = await getUntypedAdminClient()
      .from("money_category_rule_runs")
      .update({ triggered_by_user_id: triggeredByUserId })
      .in("id", runIds);
    if (error) throw new Error(error.message);
  }

  return {
    authenticateAllowedUser,
    listRules,
    getLineItemContext,
    listCategories,
    findMccCanonicalCategoryId,
    createRuleRun,
    createRuleRunStep,
    finalizeRuleRun,
    listLineItemIdsForTransaction,
    listLineItemIdsForDateRange,
    runDeterministicPreview,
    runDeterministicApplyLineItems,
    runDeterministicReplayTransaction,
    runDeterministicReplayDateRange,
    updateRunsTriggeredByUser,
  };
}
