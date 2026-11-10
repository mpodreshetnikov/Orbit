import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  MONEY_CATEGORY_RULE_MATCH_MODES,
  MONEY_CATEGORY_RULE_SCOPE_FILTERS,
  type MoneyCategoryRule,
  type MoneyCategoryRuleFilter,
  type MoneyCategoryRuleKind,
  type MoneyCategoryRuleMatchMode,
  type MoneyCategoryRuleScopeFilter,
} from "@/types/money";
import { rowToMoneyCategoryRule } from "@/types/money-rules";

/**
 * Money category rules over MCP (T-261110-raf / ORB-42): list + draft→confirm CRUD +
 * apply-with-preview. Reuses the Rules page table writes and the deterministic SQL RPCs
 * (`money_preview_category_rule_pipeline`, `money_apply_category_rule_pipeline*`).
 *
 * LLM rules (`llm_categorization`) are skipped by those RPCs (they need the
 * money-categorize edge). MCP never invents a second pipeline — if enabled LLM rules
 * are in scope, the draft summary warns that they will not run.
 *
 * Preview/confirm parity: apply RPCs hardcode `p_rule_ids=NULL` and preview hardcodes
 * `force_overwrite_locked=false`, so MCP rejects `rule_ids` and `force_overwrite_locked=true`.
 */

type Client = SupabaseClient<Database>;

/** DB `money_rule_kind` enum — do not advertise kinds the insert will reject. */
export const MCP_MONEY_RULE_KINDS = [
  "direct",
  "mcc_map",
  "llm_categorization",
  "fallback_uncategorized",
] as const satisfies readonly MoneyCategoryRuleKind[];

export type McpMoneyRuleKind = (typeof MCP_MONEY_RULE_KINDS)[number];

export type RuleDraftMode = "rule_create" | "rule_update" | "rule_delete" | "rule_apply";

export interface RuleCreateInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  sort_order?: number;
  rule_kind: McpMoneyRuleKind;
  target_category_id?: string | null;
  match_mode?: MoneyCategoryRuleMatchMode;
  scope_filter?: MoneyCategoryRuleScopeFilter;
  filters?: MoneyCategoryRuleFilter[];
  config?: Record<string, unknown>;
  stop_processing?: boolean;
}

export interface RuleUpdateInput {
  rule_id: string;
  name?: string;
  description?: string | null;
  enabled?: boolean;
  sort_order?: number;
  rule_kind?: McpMoneyRuleKind;
  target_category_id?: string | null;
  match_mode?: MoneyCategoryRuleMatchMode;
  scope_filter?: MoneyCategoryRuleScopeFilter;
  filters?: MoneyCategoryRuleFilter[];
  config?: Record<string, unknown>;
  stop_processing?: boolean;
}

export interface RuleDeleteInput {
  rule_id: string;
}

export interface RuleApplyInput {
  /** Exactly one target shape: line ids, one transaction, or a posted_at date range. */
  line_item_ids?: string[];
  transaction_id?: string;
  from?: string;
  to?: string;
  /**
   * Not supported over MCP: preview can subset via `p_rule_ids`, but apply RPCs always
   * pass NULL (all enabled). Rejected when non-empty so preview matches confirm.
   */
  rule_ids?: string[] | null;
  /**
   * Not supported over MCP: preview RPC hardcodes force=false while apply can force.
   * Rejected when true so preview matches confirm.
   */
  force_overwrite_locked?: boolean;
}

export type RuleDraftInput = RuleCreateInput | RuleUpdateInput | RuleDeleteInput | RuleApplyInput;

export interface RuleDraftView {
  mode: RuleDraftMode;
  person_id: string;
  person_name: string;
  title: string;
  summary_lines: string[];
  input: RuleDraftInput;
}

const PREVIEW_LINE_CAP = 40;
/** PostgREST `max_rows` in supabase/config.toml — unpaged selects silently truncate here. */
const POSTGREST_PAGE = 1000;

/** YYYY-MM-DD + 1 calendar day in UTC (for half-open posted_at preview windows). */
function nextUtcDateString(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function isRuleKind(value: string): value is McpMoneyRuleKind {
  return (MCP_MONEY_RULE_KINDS as readonly string[]).includes(value);
}

function isMatchMode(value: string): value is MoneyCategoryRuleMatchMode {
  return (MONEY_CATEGORY_RULE_MATCH_MODES as readonly string[]).includes(value);
}

function isScopeFilter(value: string): value is MoneyCategoryRuleScopeFilter {
  return (MONEY_CATEGORY_RULE_SCOPE_FILTERS as readonly string[]).includes(value);
}

/**
 * Same as Rules page `ruleFormProblem` regex branch: a broken pattern must not be saved
 * enabled into the pipeline (SQL `~` / JS RegExp would throw or mis-match).
 */
export function invalidRegexFilterMessage(
  filters: MoneyCategoryRuleFilter[] | undefined,
): string | null {
  for (const filter of filters ?? []) {
    if (filter.operator !== "regex") continue;
    const pattern = typeof filter.value === "string" ? filter.value : "";
    if (!pattern.trim()) continue;
    try {
      void new RegExp(pattern);
    } catch {
      return `Invalid regex filter on "${filter.field}": ${JSON.stringify(pattern)}`;
    }
  }
  return null;
}

/** Page through a PostgREST query until a short page — avoids silent max_rows truncation. */
async function fetchAllPaged<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += POSTGREST_PAGE) {
    const { data, error } = await page(offset, offset + POSTGREST_PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < POSTGREST_PAGE) break;
  }
  return { ok: true, rows };
}

export async function listMoneyCategoryRules(
  supabase: Client,
  personId: string,
): Promise<MoneyCategoryRule[]> {
  const { data, error } = await supabase
    .from("money_category_rules")
    .select("*")
    .eq("person_id", personId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToMoneyCategoryRule(row as Record<string, unknown>));
}

async function loadRule(
  supabase: Client,
  personId: string,
  ruleId: string,
): Promise<MoneyCategoryRule | null> {
  const { data, error } = await supabase
    .from("money_category_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("person_id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToMoneyCategoryRule(data as Record<string, unknown>) : null;
}

async function categoryLabel(supabase: Client, categoryId: string | null): Promise<string> {
  if (!categoryId) return "(без категории)";
  const { data, error } = await supabase
    .from("money_categories")
    .select("name_ru, name_en, slug")
    .eq("id", categoryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return categoryId;
  return data.name_ru?.trim() || data.name_en?.trim() || data.slug || categoryId;
}

async function countEnabledLlmRules(
  supabase: Client,
  personId: string,
  ruleIds?: string[] | null,
): Promise<number> {
  let query = supabase
    .from("money_category_rules")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId)
    .eq("enabled", true)
    .eq("rule_kind", "llm_categorization");
  if (ruleIds && ruleIds.length > 0) {
    query = query.in("id", ruleIds);
  }
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function formatFilterPredicate(filter: unknown): string {
  if (!filter || typeof filter !== "object") return String(filter);
  const row = filter as MoneyCategoryRuleFilter;
  const field = row.field || "?";
  const operator = row.operator || "?";
  if (row.values && row.values.length > 0) {
    return `${field} ${operator} [${row.values.join(", ")}]`;
  }
  if (row.min != null || row.max != null) {
    return `${field} ${operator} ${row.min ?? "…"}…${row.max ?? "…"}`;
  }
  if (row.value === undefined || row.value === null) {
    return `${field} ${operator}`;
  }
  return `${field} ${operator} ${JSON.stringify(row.value)}`;
}

function formatConfigLines(config: Record<string, unknown> | undefined): string[] {
  if (!config || Object.keys(config).length === 0) return [];
  return Object.entries(config).map(([key, value]) => {
    const rendered =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
    return `config.${key}: ${rendered}`;
  });
}

function summarizeRule(rule: {
  name: string;
  rule_kind: string;
  enabled: boolean;
  sort_order: number;
  scope_filter: string;
  match_mode: string;
  stop_processing: boolean;
  target_category_id?: string | null;
  filters?: unknown[];
  config?: Record<string, unknown>;
}): string[] {
  const filters = Array.isArray(rule.filters) ? rule.filters : [];
  const lines = [
    `вид: ${rule.rule_kind}`,
    `порядок: ${rule.sort_order}`,
    rule.enabled ? "включено" : "выключено",
    `scope: ${rule.scope_filter}`,
    `match: ${rule.match_mode}`,
    rule.stop_processing ? "stop_processing: да" : "stop_processing: нет",
  ];
  if (rule.target_category_id) {
    lines.push(`target_category_id: ${rule.target_category_id}`);
  }
  if (filters.length === 0) {
    lines.push("фильтры: (нет)");
  } else {
    lines.push(`фильтры (${filters.length}):`);
    for (const filter of filters.slice(0, 12)) {
      lines.push(`  ${formatFilterPredicate(filter)}`);
    }
    if (filters.length > 12) {
      lines.push(`  …и ещё ${filters.length - 12}`);
    }
  }
  lines.push(...formatConfigLines(rule.config));
  return lines;
}

function validateCreateShape(
  input: RuleCreateInput,
): { ok: true; normalized: RuleCreateInput } | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "name is required." };
  if (!isRuleKind(input.rule_kind)) {
    return {
      ok: false,
      error: `Unknown or unsupported rule_kind over MCP. Use one of: ${MCP_MONEY_RULE_KINDS.join(", ")}.`,
    };
  }
  const match_mode = input.match_mode ?? "all";
  if (!isMatchMode(match_mode)) {
    return { ok: false, error: "Invalid match_mode." };
  }
  const scope_filter = input.scope_filter ?? "all_line_items";
  if (!isScopeFilter(scope_filter)) {
    return { ok: false, error: "Invalid scope_filter." };
  }
  if (input.rule_kind === "direct" && !input.target_category_id) {
    return { ok: false, error: "direct rules need target_category_id from list_money_categories." };
  }
  const regexProblem = invalidRegexFilterMessage(input.filters);
  if (regexProblem) return { ok: false, error: regexProblem };
  return {
    ok: true,
    normalized: {
      name,
      description: input.description?.trim() || null,
      enabled: input.enabled ?? true,
      sort_order: input.sort_order,
      rule_kind: input.rule_kind,
      target_category_id: input.rule_kind === "direct" ? (input.target_category_id ?? null) : null,
      match_mode,
      scope_filter,
      filters: input.filters ?? [],
      config: input.config ?? {},
      stop_processing: input.stop_processing ?? false,
    },
  };
}

export async function buildCreateRuleDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: RuleCreateInput,
): Promise<{ ok: true; draft: RuleDraftView } | { ok: false; error: string }> {
  const validated = validateCreateShape(input);
  if (!validated.ok) return validated;

  const existing = await listMoneyCategoryRules(supabase, person.id);
  const sort_order = validated.normalized.sort_order ?? existing.length + 1;
  const normalized: RuleCreateInput = { ...validated.normalized, sort_order };

  const targetLabel =
    normalized.rule_kind === "direct"
      ? await categoryLabel(supabase, normalized.target_category_id ?? null)
      : null;

  const summary_lines = [
    ...summarizeRule({
      name: normalized.name,
      rule_kind: normalized.rule_kind,
      enabled: normalized.enabled ?? true,
      sort_order,
      scope_filter: normalized.scope_filter ?? "all_line_items",
      match_mode: normalized.match_mode ?? "all",
      stop_processing: normalized.stop_processing ?? false,
      target_category_id: normalized.target_category_id,
      filters: normalized.filters,
      config: normalized.config,
    }),
  ];
  if (targetLabel) summary_lines.push(`категория: ${targetLabel}`);
  if (normalized.rule_kind === "llm_categorization") {
    summary_lines.push(
      "LLM-правило: SQL preview/apply его пропускает (нужен money-categorize). Создание записи — ок.",
    );
  }

  return {
    ok: true,
    draft: {
      mode: "rule_create",
      person_id: person.id,
      person_name: person.name,
      title: `Новое правило «${normalized.name}»`,
      summary_lines,
      input: normalized,
    },
  };
}

export async function buildUpdateRuleDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: RuleUpdateInput,
): Promise<{ ok: true; draft: RuleDraftView } | { ok: false; error: string }> {
  const existing = await loadRule(supabase, person.id, input.rule_id);
  if (!existing) {
    return {
      ok: false,
      error: `No rule ${input.rule_id} for this person. Call list_money_category_rules.`,
    };
  }

  if (input.rule_kind !== undefined && !isRuleKind(input.rule_kind)) {
    return {
      ok: false,
      error: `Unknown or unsupported rule_kind over MCP. Use one of: ${MCP_MONEY_RULE_KINDS.join(", ")}.`,
    };
  }
  if (input.match_mode !== undefined && !isMatchMode(input.match_mode)) {
    return { ok: false, error: "Invalid match_mode." };
  }
  if (input.scope_filter !== undefined && !isScopeFilter(input.scope_filter)) {
    return { ok: false, error: "Invalid scope_filter." };
  }

  const nextKind = (input.rule_kind ?? existing.rule_kind) as string;
  if (!isRuleKind(nextKind)) {
    return {
      ok: false,
      error: `Unsupported rule_kind over MCP. Use one of: ${MCP_MONEY_RULE_KINDS.join(", ")}.`,
    };
  }
  const nextTarget =
    input.target_category_id !== undefined ? input.target_category_id : existing.target_category_id;
  if (nextKind === "direct" && !nextTarget) {
    return { ok: false, error: "direct rules need target_category_id." };
  }

  const normalized: RuleUpdateInput = {
    rule_id: existing.id,
    name: input.name?.trim() || existing.name,
    description:
      input.description !== undefined ? input.description?.trim() || null : existing.description,
    enabled: input.enabled ?? existing.enabled,
    sort_order: input.sort_order ?? existing.sort_order,
    rule_kind: nextKind,
    target_category_id: nextKind === "direct" ? nextTarget : null,
    match_mode: input.match_mode ?? existing.match_mode,
    scope_filter: input.scope_filter ?? existing.scope_filter,
    filters: input.filters ?? existing.filters,
    config: input.config ?? existing.config,
    stop_processing: input.stop_processing ?? existing.stop_processing,
  };

  const regexProblem = invalidRegexFilterMessage(normalized.filters);
  if (regexProblem) return { ok: false, error: regexProblem };

  const beforeFilters = (existing.filters ?? []).map(formatFilterPredicate);
  const afterFilters = (normalized.filters ?? []).map(formatFilterPredicate);
  const summary_lines = [
    `было: ${existing.name} (${existing.rule_kind}, ${existing.enabled ? "on" : "off"}, #${existing.sort_order})`,
    `станет: ${normalized.name} (${normalized.rule_kind}, ${normalized.enabled ? "on" : "off"}, #${normalized.sort_order})`,
    ...summarizeRule({
      name: normalized.name!,
      rule_kind: normalized.rule_kind!,
      enabled: normalized.enabled!,
      sort_order: normalized.sort_order!,
      scope_filter: normalized.scope_filter!,
      match_mode: normalized.match_mode!,
      stop_processing: normalized.stop_processing!,
      target_category_id: normalized.target_category_id,
      filters: normalized.filters,
      config: normalized.config,
    }).slice(2),
  ];
  if (JSON.stringify(beforeFilters) !== JSON.stringify(afterFilters)) {
    summary_lines.push(
      `фильтры было: ${beforeFilters.length ? beforeFilters.join("; ") : "(нет)"}`,
      `фильтры станет: ${afterFilters.length ? afterFilters.join("; ") : "(нет)"}`,
    );
  }
  if (normalized.rule_kind === "llm_categorization") {
    summary_lines.push("LLM-правило: SQL preview/apply его пропускает (нужен money-categorize).");
  }

  return {
    ok: true,
    draft: {
      mode: "rule_update",
      person_id: person.id,
      person_name: person.name,
      title: `Изменить правило «${existing.name}»`,
      summary_lines,
      input: normalized,
    },
  };
}

export async function buildDeleteRuleDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: RuleDeleteInput,
): Promise<{ ok: true; draft: RuleDraftView } | { ok: false; error: string }> {
  const existing = await loadRule(supabase, person.id, input.rule_id);
  if (!existing) {
    return {
      ok: false,
      error: `No rule ${input.rule_id} for this person. Call list_money_category_rules.`,
    };
  }

  return {
    ok: true,
    draft: {
      mode: "rule_delete",
      person_id: person.id,
      person_name: person.name,
      title: `Удалить правило «${existing.name}»`,
      summary_lines: [
        `вид: ${existing.rule_kind}`,
        `порядок: ${existing.sort_order}`,
        existing.enabled ? "сейчас включено" : "сейчас выключено",
        "Удаление необратимо; операции не откатываются.",
      ],
      input: { rule_id: existing.id },
    },
  };
}

type PreviewRun = {
  line_item_id: string;
  line_item_title: string | null;
  merchant_name: string | null;
  starting_category_id: string | null;
  final_category_id: string | null;
  changed: boolean;
};

async function previewOneLine(
  supabase: Client,
  personId: string,
  lineItemId: string,
  ruleIds?: string[] | null,
): Promise<PreviewRun> {
  const { data, error } = await supabase.rpc("money_preview_category_rule_pipeline", {
    p_line_item_id: lineItemId,
    p_person_id: personId,
    p_rule_ids: ruleIds ?? undefined,
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as Record<string, unknown>;
  const starting = (raw.starting_category_id as string | null) ?? null;
  const final = (raw.final_category_id as string | null) ?? null;
  return {
    line_item_id: String(raw.line_item_id ?? lineItemId),
    line_item_title: (raw.line_item_title as string | null) ?? null,
    merchant_name: (raw.merchant_name as string | null) ?? null,
    starting_category_id: starting,
    final_category_id: final,
    changed: starting !== final,
  };
}

async function resolveApplyLineIds(
  supabase: Client,
  personId: string,
  input: RuleApplyInput,
): Promise<{ ok: true; lineIds: string[]; scopeLabel: string } | { ok: false; error: string }> {
  const hasLines = (input.line_item_ids?.length ?? 0) > 0;
  const hasTx = Boolean(input.transaction_id);
  const hasRange = Boolean(input.from && input.to);
  const shapes = [hasLines, hasTx, hasRange].filter(Boolean).length;
  if (shapes !== 1) {
    return {
      ok: false,
      error:
        "Provide exactly one apply target: line_item_ids, transaction_id, or from+to (YYYY-MM-DD).",
    };
  }

  if (hasLines) {
    const ids = [...new Set(input.line_item_ids!)];
    const found: { id: string; transaction_id: string }[] = [];
    for (let i = 0; i < ids.length; i += POSTGREST_PAGE) {
      const chunk = ids.slice(i, i + POSTGREST_PAGE);
      const { data: lines, error } = await supabase
        .from("money_line_items")
        .select("id, transaction_id")
        .in("id", chunk);
      if (error) return { ok: false, error: error.message };
      found.push(...((lines ?? []) as { id: string; transaction_id: string }[]));
    }
    if (found.length !== ids.length) {
      return { ok: false, error: "Some line_item_ids are missing." };
    }
    const txIds = [...new Set(found.map((row) => row.transaction_id))];
    for (let i = 0; i < txIds.length; i += POSTGREST_PAGE) {
      const chunk = txIds.slice(i, i + POSTGREST_PAGE);
      const { data: txs, error: txError } = await supabase
        .from("money_transactions")
        .select("id, payer_person_id")
        .in("id", chunk);
      if (txError) return { ok: false, error: txError.message };
      if ((txs ?? []).some((tx) => tx.payer_person_id !== personId)) {
        return { ok: false, error: "Some line_item_ids belong to another person." };
      }
    }
    return { ok: true, lineIds: ids, scopeLabel: `${ids.length} line item(s)` };
  }

  if (hasTx) {
    const { data: tx, error: txError } = await supabase
      .from("money_transactions")
      .select("id, payer_person_id, merchant_name")
      .eq("id", input.transaction_id!)
      .maybeSingle();
    if (txError) return { ok: false, error: txError.message };
    if (!tx) return { ok: false, error: `No transaction ${input.transaction_id}.` };
    if (tx.payer_person_id !== personId) {
      return { ok: false, error: "That transaction belongs to a different person." };
    }
    const lines = await fetchAllPaged<{ id: string }>((from, to) =>
      supabase
        .from("money_line_items")
        .select("id")
        .eq("transaction_id", tx.id)
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (!lines.ok) return lines;
    const ids = lines.rows.map((row) => row.id);
    if (ids.length === 0) {
      return { ok: false, error: "Transaction has no line items." };
    }
    return {
      ok: true,
      lineIds: ids,
      scopeLabel: `transaction ${tx.id}${tx.merchant_name ? ` (${tx.merchant_name})` : ""}`,
    };
  }

  const from = input.from!;
  const to = input.to!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { ok: false, error: "from and to must be YYYY-MM-DD." };
  }
  if (from > to) return { ok: false, error: "from must be on or before to." };

  // Match SQL RPC posted_at::date window for sampling; confirm uses the date-range RPC.
  // Paginate past PostgREST max_rows so scopeLabel total matches what apply will touch.
  const toExclusive = nextUtcDateString(to);
  const txs = await fetchAllPaged<{ id: string }>((offsetFrom, offsetTo) =>
    supabase
      .from("money_transactions")
      .select("id")
      .eq("payer_person_id", personId)
      .gte("posted_at", `${from}T00:00:00.000Z`)
      .lt("posted_at", `${toExclusive}T00:00:00.000Z`)
      .order("id", { ascending: true })
      .range(offsetFrom, offsetTo),
  );
  if (!txs.ok) return txs;
  const txIds = txs.rows.map((row) => row.id);
  if (txIds.length === 0) {
    return {
      ok: true,
      lineIds: [],
      scopeLabel: `posted_at ${from}…${to} (0 line item(s))`,
    };
  }

  const ids: string[] = [];
  for (let i = 0; i < txIds.length; i += POSTGREST_PAGE) {
    const chunk = txIds.slice(i, i + POSTGREST_PAGE);
    const lines = await fetchAllPaged<{ id: string }>((offsetFrom, offsetTo) =>
      supabase
        .from("money_line_items")
        .select("id")
        .in("transaction_id", chunk)
        .order("id", { ascending: true })
        .range(offsetFrom, offsetTo),
    );
    if (!lines.ok) return lines;
    ids.push(...lines.rows.map((row) => row.id));
  }
  return {
    ok: true,
    lineIds: ids,
    scopeLabel: `posted_at ${from}…${to} (${ids.length} line item(s))`,
  };
}

export async function buildApplyRulesDraft(
  supabase: Client,
  person: { id: string; name: string },
  input: RuleApplyInput,
): Promise<{ ok: true; draft: RuleDraftView } | { ok: false; error: string }> {
  // Apply RPCs hardcode p_rule_ids=NULL; preview must not advertise a subset it cannot apply.
  if (input.rule_ids != null && input.rule_ids.length > 0) {
    return {
      ok: false,
      error:
        "rule_ids is not supported over MCP: money_apply_category_rule_pipeline* always runs all enabled rules (p_rule_ids=NULL), so a subset preview would not match confirm. Omit rule_ids.",
    };
  }
  // Preview RPC hardcodes force_overwrite_locked=false; refuse force so preview matches apply.
  if (input.force_overwrite_locked === true) {
    return {
      ok: false,
      error:
        "force_overwrite_locked=true is not supported over MCP: money_preview_category_rule_pipeline always previews with force=false, so confirm would change more than the draft shows. Omit force_overwrite_locked or set false.",
    };
  }

  const resolved = await resolveApplyLineIds(supabase, person.id, input);
  if (!resolved.ok) return resolved;

  const llmCount = await countEnabledLlmRules(supabase, person.id, null);
  const previewIds = resolved.lineIds.slice(0, PREVIEW_LINE_CAP);
  const runs: PreviewRun[] = [];
  for (const lineId of previewIds) {
    // Always preview with null rule_ids — same as apply RPC.
    runs.push(await previewOneLine(supabase, person.id, lineId, null));
  }
  const wouldChange = runs.filter((run) => run.changed);
  const truncated = resolved.lineIds.length > previewIds.length;

  const categoryIds = new Set<string>();
  for (const run of wouldChange.slice(0, 8)) {
    if (run.starting_category_id) categoryIds.add(run.starting_category_id);
    if (run.final_category_id) categoryIds.add(run.final_category_id);
  }
  const labels = new Map<string, string>();
  await Promise.all(
    [...categoryIds].map(async (id) => {
      labels.set(id, await categoryLabel(supabase, id));
    }),
  );

  const sample = wouldChange.slice(0, 8).map((run) => {
    const title = run.line_item_title || run.merchant_name || run.line_item_id;
    const fromLabel = run.starting_category_id
      ? (labels.get(run.starting_category_id) ?? run.starting_category_id)
      : "(без категории)";
    const toLabel = run.final_category_id
      ? (labels.get(run.final_category_id) ?? run.final_category_id)
      : "(без категории)";
    return `«${title}»: ${fromLabel} → ${toLabel}`;
  });

  const normalized: RuleApplyInput = {
    ...(input.line_item_ids?.length ? { line_item_ids: [...new Set(input.line_item_ids)] } : {}),
    ...(input.transaction_id ? { transaction_id: input.transaction_id } : {}),
    ...(input.from && input.to ? { from: input.from, to: input.to } : {}),
    force_overwrite_locked: false,
  };

  const summary_lines = [
    `область: ${resolved.scopeLabel}`,
    `превью: ${previewIds.length} строк` +
      (truncated ? ` (из ${resolved.lineIds.length}; остальные не в превью)` : ""),
    `изменится: ${wouldChange.length} из ${previewIds.length} в превью`,
    "force_overwrite_locked: нет (preview и apply совпадают; force через MCP недоступен)",
    "правила: все enabled (rule_ids subset через MCP недоступен — apply RPC всегда NULL)",
  ];
  if (llmCount > 0) {
    summary_lines.push(
      `внимание: ${llmCount} включённых LLM-правил(а) SQL RPC пропускает — они не применятся через MCP (нужен money-categorize edge, как на Rules page).`,
    );
  }
  if (sample.length === 0) {
    summary_lines.push("в превью нет строк, у которых категория изменится");
  } else {
    summary_lines.push("примеры:", ...sample);
  }

  return {
    ok: true,
    draft: {
      mode: "rule_apply",
      person_id: person.id,
      person_name: person.name,
      title: "Применить правила категоризации",
      summary_lines,
      input: normalized,
    },
  };
}

export async function applyRuleDraft(
  supabase: Client,
  person: { id: string; name: string },
  mode: RuleDraftMode,
  input: RuleDraftInput,
): Promise<{ ok: true; label: string; id: string } | { ok: false; error: string }> {
  if (mode === "rule_create") {
    const built = await buildCreateRuleDraft(supabase, person, input as RuleCreateInput);
    if (!built.ok) return built;
    const create = built.draft.input as RuleCreateInput;
    type RuleInsert = Database["public"]["Tables"]["money_category_rules"]["Insert"];
    const { data, error } = await supabase
      .from("money_category_rules")
      .insert({
        person_id: person.id,
        name: create.name,
        description: create.description ?? null,
        enabled: create.enabled ?? true,
        sort_order: create.sort_order!,
        rule_kind: create.rule_kind as RuleInsert["rule_kind"],
        target_category_id: create.target_category_id ?? null,
        match_mode: create.match_mode ?? "all",
        scope_filter: create.scope_filter ?? "all_line_items",
        filters: (create.filters ?? []) as unknown as Json,
        config: (create.config ?? {}) as Json,
        stop_processing: create.stop_processing ?? false,
      })
      .select("id, name")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id, label: data.name };
  }

  if (mode === "rule_update") {
    const built = await buildUpdateRuleDraft(supabase, person, input as RuleUpdateInput);
    if (!built.ok) return built;
    const update = built.draft.input as RuleUpdateInput;
    type RuleUpdate = Database["public"]["Tables"]["money_category_rules"]["Update"];
    const { data, error } = await supabase
      .from("money_category_rules")
      .update({
        name: update.name,
        description: update.description,
        enabled: update.enabled,
        sort_order: update.sort_order,
        rule_kind: update.rule_kind as RuleUpdate["rule_kind"],
        target_category_id: update.target_category_id,
        match_mode: update.match_mode,
        scope_filter: update.scope_filter,
        filters: update.filters as unknown as Json,
        config: update.config as Json,
        stop_processing: update.stop_processing,
      })
      .eq("id", update.rule_id)
      .eq("person_id", person.id)
      .select("id, name")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id, label: data.name };
  }

  if (mode === "rule_delete") {
    const built = await buildDeleteRuleDraft(supabase, person, input as RuleDeleteInput);
    if (!built.ok) return built;
    const del = built.draft.input as RuleDeleteInput;
    const existing = await loadRule(supabase, person.id, del.rule_id);
    const label = existing?.name ?? del.rule_id;
    const { error } = await supabase
      .from("money_category_rules")
      .delete()
      .eq("id", del.rule_id)
      .eq("person_id", person.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: del.rule_id, label };
  }

  const built = await buildApplyRulesDraft(supabase, person, input as RuleApplyInput);
  if (!built.ok) return built;
  const apply = built.draft.input as RuleApplyInput;
  // Confirm reuses the same preview/apply constraints (rule_ids / force rejected above).

  // Same RPCs as Rules page non-LLM path. When LLM rules are enabled the web UI
  // routes through money-categorize; MCP keeps the SQL path and warned on propose.
  if (apply.transaction_id) {
    const { data, error } = await supabase.rpc(
      "money_apply_category_rule_pipeline_for_transaction",
      {
        p_transaction_id: apply.transaction_id,
        p_person_id: person.id,
        p_force_overwrite_locked: false,
      },
    );
    if (error) return { ok: false, error: error.message };
    const runs = Array.isArray((data as { runs?: unknown[] } | null)?.runs)
      ? ((data as { runs: unknown[] }).runs ?? [])
      : [];
    return {
      ok: true,
      id: apply.transaction_id,
      label: `applied to transaction (${runs.length} run(s))`,
    };
  }

  if (apply.from && apply.to) {
    const { data, error } = await supabase.rpc(
      "money_apply_category_rule_pipeline_for_date_range",
      {
        p_person_id: person.id,
        p_from: apply.from,
        p_to: apply.to,
        p_force_overwrite_locked: false,
      },
    );
    if (error) return { ok: false, error: error.message };
    const runs = Array.isArray((data as { runs?: unknown[] } | null)?.runs)
      ? ((data as { runs: unknown[] }).runs ?? [])
      : [];
    return {
      ok: true,
      id: `${apply.from}_${apply.to}`,
      label: `applied to date range (${runs.length} run(s))`,
    };
  }

  const lineIds = apply.line_item_ids ?? [];
  const { data, error } = await supabase.rpc("money_apply_category_rule_pipeline", {
    p_line_item_ids: lineIds,
    p_person_id: person.id,
    p_force_overwrite_locked: false,
    p_trigger_source: "manual_replay",
  });
  if (error) return { ok: false, error: error.message };
  const runs = Array.isArray((data as { runs?: unknown[] } | null)?.runs)
    ? ((data as { runs: unknown[] }).runs ?? [])
    : [];
  return {
    ok: true,
    id: lineIds[0] ?? "none",
    label: `applied to ${lineIds.length} line(s) (${runs.length} run(s))`,
  };
}

export function ruleDraftSummaryText(draft: RuleDraftView): string {
  const action =
    draft.mode === "rule_create"
      ? "create category rule"
      : draft.mode === "rule_update"
        ? "update category rule"
        : draft.mode === "rule_delete"
          ? "delete category rule"
          : "apply category rules";
  return (
    `Showing a ${action} draft for ${draft.person_name} on a card: ${draft.title}. ` +
    `Nothing is saved until the owner presses Confirm; end your turn and wait.`
  );
}
