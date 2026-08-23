export type MoneyCategoryKind = "canonical" | "custom";
export type MoneyAssignmentMethod = "rule" | "llm";
export type MoneyRuleKind = "direct" | "mcc_map" | "llm_categorization" | "fallback_uncategorized";
export type MoneyRuleMatchMode = "all" | "any";
export type MoneyRuleScopeFilter =
  | "all_line_items"
  | "uncategorized_only"
  | "custom_only"
  | "canonical_only"
  | "manual_unlocked_only";
export type MoneyRuleFilterOperator =
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

const DEFAULT_LLM_BATCH_SIZE = 4;

export interface MoneyCategoryRuleFilter {
  field: string;
  operator: MoneyRuleFilterOperator;
  value?: string | number | boolean | null;
  values?: string[];
  min?: number | null;
  max?: number | null;
}

export interface MoneyCategoryRule {
  id: string;
  person_id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  sort_order: number;
  rule_kind: MoneyRuleKind;
  target_category_id: string | null;
  match_mode: MoneyRuleMatchMode;
  scope_filter: MoneyRuleScopeFilter;
  filters: MoneyCategoryRuleFilter[];
  config: Record<string, unknown>;
  stop_processing: boolean;
  created_at?: string | null;
}

export interface MoneyCategory {
  id: string;
  parent_id: string | null;
  canonical_category_id: string;
  category_kind: MoneyCategoryKind;
  system_key: string | null;
  sort_order: number;
  created_by?: string | null;
  depth: number;
  name_en: string;
  name_ru: string;
  slug: string;
  archived_at: string | null;
}

export interface MoneyCategoryRuleContext {
  line_item: {
    id: string;
    transaction_id: string;
    title: string | null;
    amount: number | null;
    quantity: number | null;
    unit: string | null;
    line_status: string | null;
    category_id: string | null;
    assignment_method: string | null;
    assignment_rule_id: string | null;
    assignment_confidence: number | null;
    raw_payload: Record<string, unknown>;
    category_locked_by_user: boolean;
    last_category_rule_id: string | null;
    last_category_rule_run_id: string | null;
    category_assigned_at: string | null;
  };
  transaction: {
    id: string;
    payer_person_id: string;
    account_id: string | null;
    source: string | null;
    posted_at: string | null;
    amount: number | null;
    currency: string | null;
    transaction_type: string | null;
    status: string | null;
    merchant_name: string | null;
    mcc: string | null;
    comment: string | null;
    source_comment: string | null;
    source_category_id: string | null;
    source_category_name: string | null;
    cashback_amount: number | null;
    brand_id: string | null;
    is_transfer: boolean | null;
    raw_payload: Record<string, unknown>;
  };
  account: {
    source: string | null;
    account_kind: string | null;
  };
  current_category: {
    id: string | null;
    kind: MoneyCategoryKind | null;
    canonical_category_id: string | null;
    canonical_system_key: string | null;
  };
  derived: {
    normalized_line_item_title: string | null;
    normalized_merchant_name: string | null;
    absolute_line_item_amount: number | null;
    unit_price: number | null;
    posted_day_of_week: number | null;
    posted_month: number | null;
    current_category_kind: MoneyCategoryKind | null;
    current_canonical_system_key: string | null;
    has_receipt_metadata: boolean;
  };
}

export interface MoneyCategoryRuleStepResult {
  step_id: string | null;
  rule_id: string;
  rule_name: string;
  rule_kind: MoneyRuleKind;
  sort_order: number;
  matched: boolean;
  changed_category: boolean;
  previous_category_id: string | null;
  next_category_id: string | null;
  decision_reason: string;
  debug_payload: Record<string, unknown>;
}

export interface MoneyCategoryRuleRunResult {
  run_id: string | null;
  line_item_id: string;
  line_item_title: string | null;
  transaction_id: string;
  merchant_name: string | null;
  person_id: string;
  trigger_source: string;
  starting_category_id: string | null;
  final_category_id: string | null;
  saved: boolean;
  llm_tokens_prompt: number | null;
  llm_tokens_completion: number | null;
  decision_reason?: string | null;
  steps: MoneyCategoryRuleStepResult[];
}

export interface MoneyCategorizeRepository {
  listRules(personId: string, ruleIds?: string[] | null): Promise<MoneyCategoryRule[]>;
  getLineItemContext(
    lineItemId: string,
    personId?: string | null,
  ): Promise<MoneyCategoryRuleContext | null>;
  listCategories(): Promise<MoneyCategory[]>;
  findMccCanonicalCategoryId(mcc: string): Promise<string | null>;
  createRuleRun(payload: Record<string, unknown>): Promise<string>;
  createRuleRunStep(payload: Record<string, unknown>): Promise<string>;
  finalizeRuleRun(payload: Record<string, unknown>): Promise<void>;
  listLineItemIdsForTransaction(transactionId: string): Promise<string[]>;
  listLineItemIdsForDateRange(personId: string, from: string, to: string): Promise<string[]>;
  runDeterministicPreview(input: {
    lineItemId: string;
    personId?: string | null;
    ruleIds?: string[] | null;
  }): Promise<MoneyCategoryRuleRunResult>;
  runDeterministicApplyLineItems(input: {
    lineItemIds: string[];
    personId: string;
    forceOverwriteLocked: boolean;
    triggerSource: string;
  }): Promise<{ runs: MoneyCategoryRuleRunResult[]; count: number }>;
  runDeterministicReplayTransaction(input: {
    transactionId: string;
    personId?: string | null;
    forceOverwriteLocked: boolean;
  }): Promise<{ runs: MoneyCategoryRuleRunResult[]; count: number }>;
  runDeterministicReplayDateRange(input: {
    personId: string;
    from: string;
    to: string;
    forceOverwriteLocked: boolean;
  }): Promise<{ runs: MoneyCategoryRuleRunResult[]; count: number }>;
  updateRunsTriggeredByUser(runIds: string[], triggeredByUserId: string): Promise<void>;
}

export interface MoneyCategorizeCandidateCategory {
  id: string;
  name_en: string;
  name_ru: string;
  slug: string;
  category_kind: MoneyCategoryKind;
  canonical_category_id: string;
  canonical_system_key: string | null;
}

export interface MoneyCategorizeLlmBatchRequestItem {
  lineItemId: string;
  context: MoneyCategoryRuleContext;
  currentCategoryId: string | null;
  currentCanonicalSystemKey: string | null;
}

export interface MoneyCategorizeLlmBatchRequest {
  rule: MoneyCategoryRule;
  candidateCategories: MoneyCategorizeCandidateCategory[];
  items: MoneyCategorizeLlmBatchRequestItem[];
}

export interface MoneyCategorizeLlmBatchResultItem {
  lineItemId: string;
  categoryId: string | null;
  reason: string | null;
  rawResponse?: Record<string, unknown> | null;
}

export interface MoneyCategorizeLlmBatchResult {
  items: MoneyCategorizeLlmBatchResultItem[];
  promptTokens?: number | null;
  completionTokens?: number | null;
  rawResponse?: Record<string, unknown> | null;
  model?: string | null;
}

export interface MoneyCategorizeServiceDeps {
  repository: MoneyCategorizeRepository;
  llmBatchSize?: number;
  categorizeWithLlmBatch(
    request: MoneyCategorizeLlmBatchRequest,
  ): Promise<MoneyCategorizeLlmBatchResult>;
}

interface CategoryState {
  currentCategoryId: string | null;
  currentCategoryKind: MoneyCategoryKind | null;
  currentCanonicalCategoryId: string | null;
  currentCanonicalSystemKey: string | null;
}

interface PipelineRunOptions {
  lineItemId: string;
  personId: string;
  ruleIds?: string[] | null;
  save: boolean;
  forceOverwriteLocked: boolean;
  triggerSource: string;
  triggeredByUserId?: string | null;
}

interface PreparedPipelineData {
  rules: MoneyCategoryRule[];
  categories: MoneyCategory[];
  categoriesById: Map<string, MoneyCategory>;
  candidateCategories: MoneyCategorizeCandidateCategory[];
  mccCache: Map<string, string | null>;
}

interface PipelineItemState {
  options: PipelineRunOptions;
  context: MoneyCategoryRuleContext;
  startingState: CategoryState;
  state: CategoryState;
  runId: string | null;
  lastChangedRuleId: string | null;
  lastAssignmentMethod: MoneyAssignmentMethod | null;
  promptTokens: number;
  completionTokens: number;
  usedSharedLlmBatch: boolean;
  steps: MoneyCategoryRuleStepResult[];
  decisionReason: string | null;
  stopped: boolean;
}

interface IndexedPipelineItemState {
  index: number;
  item: PipelineItemState;
}

interface RuleEvaluation {
  indexedItem: IndexedPipelineItemState;
  previousCategoryId: string | null;
  matched: boolean;
  matchedFilterCount: number;
  totalFilterCount: number;
  reason: string;
  targetCategoryId: string | null;
}

interface LlmDecision {
  result: MoneyCategorizeLlmBatchResultItem;
  batched: boolean;
  batchSize: number;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  fallbackMode: string | null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeComparableText(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function formatComparableNumber(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value).toString();
}

function toComparableStringArray(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => normalizeComparableText(value))
    .filter((value): value is string => Boolean(value));
}

function matchesAnyContains(textValue: string | null, setValues: string[]): boolean {
  if (!textValue || setValues.length === 0) return false;
  return setValues.some((value) => textValue.includes(value));
}

function getInitialCategoryState(context: MoneyCategoryRuleContext): CategoryState {
  return {
    currentCategoryId: context.current_category.id,
    currentCategoryKind: context.current_category.kind,
    currentCanonicalCategoryId: context.current_category.canonical_category_id,
    currentCanonicalSystemKey: context.current_category.canonical_system_key,
  };
}

function buildCategoryState(
  categoryId: string | null,
  categoriesById: Map<string, MoneyCategory>,
): CategoryState {
  if (!categoryId) {
    return {
      currentCategoryId: null,
      currentCategoryKind: null,
      currentCanonicalCategoryId: null,
      currentCanonicalSystemKey: null,
    };
  }

  const category = categoriesById.get(categoryId);
  const canonical = category ? (categoriesById.get(category.canonical_category_id) ?? null) : null;

  return {
    currentCategoryId: categoryId,
    currentCategoryKind: category?.category_kind ?? null,
    currentCanonicalCategoryId: category?.canonical_category_id ?? null,
    currentCanonicalSystemKey: canonical?.system_key ?? null,
  };
}

function getFilterRawValue(
  context: MoneyCategoryRuleContext,
  state: CategoryState,
  field: string,
): string | number | boolean | null {
  switch (field) {
    case "line_item_title":
      return context.line_item.title;
    case "merchant_name":
      return context.transaction.merchant_name;
    case "transaction_comment":
      return context.transaction.comment;
    case "source_comment":
      return context.transaction.source_comment;
    case "source":
      return context.transaction.source;
    case "source_category_id":
      return context.transaction.source_category_id;
    case "source_category_name":
      return context.transaction.source_category_name;
    case "mcc":
      return context.transaction.mcc;
    case "transaction_type":
      return context.transaction.transaction_type;
    case "account_source":
      return context.account.source;
    case "account_kind":
      return context.account.account_kind;
    case "payer_person_id":
      return context.transaction.payer_person_id;
    case "current_category_id":
      return state.currentCategoryId;
    case "canonical_branch_system_key":
      return state.currentCanonicalSystemKey;
    case "is_transfer":
      return context.transaction.is_transfer;
    case "line_item_amount":
      return context.line_item.amount;
    case "transaction_amount":
      return context.transaction.amount;
    default:
      return null;
  }
}

function evaluateRuleFilter(
  context: MoneyCategoryRuleContext,
  state: CategoryState,
  filter: MoneyCategoryRuleFilter,
): boolean {
  const rawValue = getFilterRawValue(context, state, filter.field);
  const textValue = normalizeComparableText(rawValue);
  const filterValue = normalizeComparableText(filter.value);
  const setValues = toComparableStringArray(filter.values);
  const numericValue =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string" &&
          rawValue.trim().length > 0 &&
          Number.isFinite(Number(rawValue))
        ? Number(rawValue)
        : null;
  const booleanValue = typeof rawValue === "boolean" ? rawValue : null;

  switch (filter.operator) {
    case "contains":
      return Boolean(textValue && filterValue && textValue.includes(filterValue));
    case "not_contains":
      return !textValue || !filterValue || !textValue.includes(filterValue);
    case "equals":
      if (filter.field === "line_item_amount" || filter.field === "transaction_amount") {
        const expected =
          typeof filter.value === "number"
            ? filter.value
            : typeof filter.value === "string" && filter.value.trim().length > 0
              ? Number(filter.value)
              : null;
        return numericValue != null && expected != null && numericValue === expected;
      }
      if (filter.field === "is_transfer") {
        const expected =
          typeof filter.value === "boolean"
            ? filter.value
            : typeof filter.value === "string"
              ? filter.value === "true"
              : null;
        return booleanValue != null && expected != null && booleanValue === expected;
      }
      return textValue != null && filterValue != null && textValue === filterValue;
    case "starts_with":
      return Boolean(textValue && filterValue && textValue.startsWith(filterValue));
    case "regex":
      try {
        return new RegExp(String(filter.value ?? "")).test(String(rawValue ?? ""));
      } catch {
        return false;
      }
    case "contains_any_in_set":
      return matchesAnyContains(textValue, setValues);
    case "equals_any_in_set":
    case "in_set":
      if (filter.field === "line_item_amount" || filter.field === "transaction_amount") {
        const comparable = formatComparableNumber(numericValue);
        return comparable != null && setValues.includes(comparable);
      }
      if (filter.field === "is_transfer") {
        return booleanValue != null && setValues.includes(String(booleanValue));
      }
      return textValue != null && setValues.includes(textValue);
    case "range": {
      if (numericValue == null) return false;
      const min = filter.min ?? null;
      const max = filter.max ?? null;
      return (min == null || min <= numericValue) && (max == null || max >= numericValue);
    }
    case "is_empty":
      return textValue == null;
    case "is_not_empty":
      return textValue != null;
    default:
      return false;
  }
}

function evaluateRuleFilters(
  context: MoneyCategoryRuleContext,
  state: CategoryState,
  rule: MoneyCategoryRule,
): { matched: boolean; matchedFilterCount: number; totalFilterCount: number } {
  const filters = rule.filters ?? [];
  if (filters.length === 0) {
    return { matched: true, matchedFilterCount: 0, totalFilterCount: 0 };
  }

  let matchedFilterCount = 0;
  let matched = rule.match_mode === "all";

  for (const filter of filters) {
    const passes = evaluateRuleFilter(context, state, filter);
    if (passes) matchedFilterCount += 1;

    if (rule.match_mode === "any" && passes) {
      matched = true;
    } else if (rule.match_mode === "all" && !passes) {
      matched = false;
      break;
    }
  }

  if (rule.match_mode === "any") {
    matched = matchedFilterCount > 0;
  }

  return {
    matched,
    matchedFilterCount,
    totalFilterCount: filters.length,
  };
}

function scopeFilterPasses(
  scopeFilter: MoneyRuleScopeFilter,
  state: CategoryState,
  locked: boolean,
): boolean {
  switch (scopeFilter) {
    case "all_line_items":
      return true;
    case "uncategorized_only":
      return state.currentCategoryId == null;
    case "custom_only":
      return state.currentCategoryKind === "custom";
    case "canonical_only":
      return state.currentCategoryKind === "canonical";
    case "manual_unlocked_only":
      return !locked;
    default:
      return true;
  }
}

function buildStepDebugPayload(input: {
  rule: MoneyCategoryRule;
  state: CategoryState;
  targetCategoryId: string | null;
  matchedFilterCount: number;
  totalFilterCount: number;
  forceOverwriteLocked: boolean;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    rule_kind: input.rule.rule_kind,
    scope_filter: input.rule.scope_filter,
    filters: input.rule.filters ?? [],
    config: input.rule.config ?? {},
    current_category_id: input.state.currentCategoryId,
    current_canonical_category_id: input.state.currentCanonicalCategoryId,
    current_canonical_system_key: input.state.currentCanonicalSystemKey,
    target_category_id: input.targetCategoryId,
    matched_filter_count: input.matchedFilterCount,
    total_filter_count: input.totalFilterCount,
    force_overwrite_locked: input.forceOverwriteLocked,
    ...(input.extra ?? {}),
  };
}

function extractRunIds(runs: MoneyCategoryRuleRunResult[]): string[] {
  return runs.map((run) => run.run_id).filter((runId): runId is string => Boolean(runId));
}

function chunkValues<T>(values: T[], size: number): T[][] {
  if (values.length === 0) return [];
  const normalizedSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += normalizedSize) {
    chunks.push(values.slice(index, index + normalizedSize));
  }
  return chunks;
}

function resolveLlmBatchSize(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LLM_BATCH_SIZE;
  }
  return Math.max(1, Math.floor(value));
}

function buildCandidateCategories(
  categories: MoneyCategory[],
  categoriesById: Map<string, MoneyCategory>,
): MoneyCategorizeCandidateCategory[] {
  return categories
    .filter((category) => !category.archived_at)
    .map((category) => ({
      id: category.id,
      name_en: category.name_en,
      name_ru: category.name_ru,
      slug: category.slug,
      category_kind: category.category_kind,
      canonical_category_id: category.canonical_category_id,
      canonical_system_key: categoriesById.get(category.canonical_category_id)?.system_key ?? null,
    }));
}

function createItemState(
  options: PipelineRunOptions,
  context: MoneyCategoryRuleContext,
  runId: string | null,
): PipelineItemState {
  const startingState = getInitialCategoryState(context);
  return {
    options,
    context,
    startingState,
    state: { ...startingState },
    runId,
    lastChangedRuleId: null,
    lastAssignmentMethod: null,
    promptTokens: 0,
    completionTokens: 0,
    usedSharedLlmBatch: false,
    steps: [],
    decisionReason: null,
    stopped: false,
  };
}

function buildRunResult(item: PipelineItemState, saved: boolean): MoneyCategoryRuleRunResult {
  return {
    run_id: item.runId,
    line_item_id: item.options.lineItemId,
    line_item_title: item.context.line_item.title,
    transaction_id: item.context.transaction.id,
    merchant_name: item.context.transaction.merchant_name,
    person_id: item.options.personId,
    trigger_source: item.options.triggerSource,
    starting_category_id: item.startingState.currentCategoryId,
    final_category_id: item.state.currentCategoryId,
    saved,
    llm_tokens_prompt: item.usedSharedLlmBatch
      ? null
      : item.promptTokens > 0
        ? item.promptTokens
        : null,
    llm_tokens_completion: item.usedSharedLlmBatch
      ? null
      : item.completionTokens > 0
        ? item.completionTokens
        : null,
    decision_reason: item.decisionReason,
    steps: item.steps,
  };
}

async function finalizePersistedRun(
  item: PipelineItemState,
  deps: MoneyCategorizeServiceDeps,
): Promise<MoneyCategoryRuleRunResult> {
  const saved =
    item.options.save && item.state.currentCategoryId !== item.startingState.currentCategoryId;
  const result = buildRunResult(item, saved);

  if (item.options.save && item.runId) {
    await deps.repository.finalizeRuleRun({
      run_id: item.runId,
      final_category_id: item.state.currentCategoryId,
      saved,
      last_changed_rule_id: item.lastChangedRuleId,
      last_assignment_method: item.lastAssignmentMethod,
      llm_tokens_prompt: result.llm_tokens_prompt,
      llm_tokens_completion: result.llm_tokens_completion,
    });
  }

  return result;
}

function createMissingLlmResult(
  lineItemId: string,
  reason: string,
): MoneyCategorizeLlmBatchResultItem {
  return {
    lineItemId,
    categoryId: null,
    reason,
    rawResponse: null,
  };
}

async function resolveSingleLlmDecision(
  evaluation: RuleEvaluation,
  rule: MoneyCategoryRule,
  candidateCategories: MoneyCategorizeCandidateCategory[],
  deps: MoneyCategorizeServiceDeps,
  fallbackMode: string | null,
): Promise<LlmDecision> {
  const batchResult = await deps.categorizeWithLlmBatch({
    rule,
    candidateCategories,
    items: [
      {
        lineItemId: evaluation.indexedItem.item.options.lineItemId,
        context: evaluation.indexedItem.item.context,
        currentCategoryId: evaluation.indexedItem.item.state.currentCategoryId,
        currentCanonicalSystemKey: evaluation.indexedItem.item.state.currentCanonicalSystemKey,
      },
    ],
  });

  const result =
    batchResult.items.find(
      (item) => item.lineItemId === evaluation.indexedItem.item.options.lineItemId,
    ) ??
    createMissingLlmResult(
      evaluation.indexedItem.item.options.lineItemId,
      "LLM response did not include the requested line item",
    );

  return {
    result,
    batched: false,
    batchSize: 1,
    model: batchResult.model ?? null,
    promptTokens: batchResult.promptTokens ?? null,
    completionTokens: batchResult.completionTokens ?? null,
    fallbackMode,
  };
}

async function resolveLlmDecisions(
  evaluations: RuleEvaluation[],
  rule: MoneyCategoryRule,
  candidateCategories: MoneyCategorizeCandidateCategory[],
  deps: MoneyCategorizeServiceDeps,
): Promise<Map<string, LlmDecision>> {
  const decisions = new Map<string, LlmDecision>();
  if (evaluations.length === 0) return decisions;

  if (evaluations.length === 1) {
    const singleDecision = await resolveSingleLlmDecision(
      evaluations[0],
      rule,
      candidateCategories,
      deps,
      null,
    );
    decisions.set(evaluations[0].indexedItem.item.options.lineItemId, singleDecision);
    return decisions;
  }

  try {
    const batchResult = await deps.categorizeWithLlmBatch({
      rule,
      candidateCategories,
      items: evaluations.map((evaluation) => ({
        lineItemId: evaluation.indexedItem.item.options.lineItemId,
        context: evaluation.indexedItem.item.context,
        currentCategoryId: evaluation.indexedItem.item.state.currentCategoryId,
        currentCanonicalSystemKey: evaluation.indexedItem.item.state.currentCanonicalSystemKey,
      })),
    });

    const resultByLineItemId = new Map<string, MoneyCategorizeLlmBatchResultItem>();
    for (const item of batchResult.items) {
      if (!item.lineItemId || resultByLineItemId.has(item.lineItemId)) continue;
      resultByLineItemId.set(item.lineItemId, item);
    }

    const unresolved: RuleEvaluation[] = [];
    for (const evaluation of evaluations) {
      const lineItemId = evaluation.indexedItem.item.options.lineItemId;
      const result = resultByLineItemId.get(lineItemId);
      if (!result) {
        unresolved.push(evaluation);
        continue;
      }

      decisions.set(lineItemId, {
        result,
        batched: true,
        batchSize: evaluations.length,
        model: batchResult.model ?? null,
        promptTokens: batchResult.promptTokens ?? null,
        completionTokens: batchResult.completionTokens ?? null,
        fallbackMode: null,
      });
    }

    for (const evaluation of unresolved) {
      decisions.set(
        evaluation.indexedItem.item.options.lineItemId,
        await resolveSingleLlmDecision(
          evaluation,
          rule,
          candidateCategories,
          deps,
          "retry_single_after_partial_batch",
        ),
      );
    }

    return decisions;
  } catch {
    for (const evaluation of evaluations) {
      decisions.set(
        evaluation.indexedItem.item.options.lineItemId,
        await resolveSingleLlmDecision(
          evaluation,
          rule,
          candidateCategories,
          deps,
          "retry_single_after_batch_failure",
        ),
      );
    }
    return decisions;
  }
}

async function recordRuleStep(
  evaluation: RuleEvaluation,
  rule: MoneyCategoryRule,
  deps: MoneyCategorizeServiceDeps,
  extraDebug?: Record<string, unknown>,
): Promise<void> {
  const item = evaluation.indexedItem.item;
  const changedCategory = evaluation.previousCategoryId !== item.state.currentCategoryId;
  const debugPayload = buildStepDebugPayload({
    rule,
    state: item.state,
    targetCategoryId: evaluation.targetCategoryId,
    matchedFilterCount: evaluation.matchedFilterCount,
    totalFilterCount: evaluation.totalFilterCount,
    forceOverwriteLocked: item.options.forceOverwriteLocked,
    extra: extraDebug,
  });

  let stepId: string | null = null;
  if (item.options.save && item.runId) {
    stepId = await deps.repository.createRuleRunStep({
      rule_run_id: item.runId,
      rule_id: rule.id,
      rule_name: rule.name,
      rule_kind: rule.rule_kind,
      sort_order: rule.sort_order,
      matched: evaluation.matched,
      changed_category: changedCategory,
      previous_category_id: evaluation.previousCategoryId,
      next_category_id: item.state.currentCategoryId,
      decision_reason: evaluation.reason,
      debug_payload: debugPayload,
    });
  }

  item.steps.push({
    step_id: stepId,
    rule_id: rule.id,
    rule_name: rule.name,
    rule_kind: rule.rule_kind,
    sort_order: rule.sort_order,
    matched: evaluation.matched,
    changed_category: changedCategory,
    previous_category_id: evaluation.previousCategoryId,
    next_category_id: item.state.currentCategoryId,
    decision_reason: evaluation.reason,
    debug_payload: debugPayload,
  });
}

function applyCategoryChange(
  item: PipelineItemState,
  nextCategoryId: string,
  categoriesById: Map<string, MoneyCategory>,
  assignmentMethod: MoneyAssignmentMethod,
  ruleId: string,
): void {
  item.state = buildCategoryState(nextCategoryId, categoriesById);
  item.lastChangedRuleId = ruleId;
  item.lastAssignmentMethod = assignmentMethod;
}

async function executePipelineChunk(
  chunkOptions: PipelineRunOptions[],
  pipelineData: PreparedPipelineData,
  deps: MoneyCategorizeServiceDeps,
): Promise<MoneyCategoryRuleRunResult[]> {
  const results = new Array<MoneyCategoryRuleRunResult | null>(chunkOptions.length).fill(null);
  const contexts = await Promise.all(
    chunkOptions.map((options) =>
      deps.repository.getLineItemContext(options.lineItemId, options.personId),
    ),
  );

  const activeItems: IndexedPipelineItemState[] = [];

  for (let index = 0; index < chunkOptions.length; index += 1) {
    const context = contexts[index];
    const options = chunkOptions[index];
    if (!context) {
      throw new Error(`Line item ${options.lineItemId} was not found for category pipeline`);
    }

    let runId: string | null = null;
    if (options.save) {
      runId = await deps.repository.createRuleRun({
        person_id: options.personId,
        triggered_by_user_id: options.triggeredByUserId ?? null,
        trigger_source: options.triggerSource,
        line_item_id: options.lineItemId,
        transaction_id: context.transaction.id,
        starting_category_id: context.current_category.id,
        final_category_id: context.current_category.id,
        saved: false,
      });
    }

    const item = createItemState(options, context, runId);
    if (context.line_item.category_locked_by_user && !options.forceOverwriteLocked) {
      item.decisionReason = "Line item is locked by a manual category assignment";
      results[index] = await finalizePersistedRun(item, deps);
      continue;
    }

    activeItems.push({ index, item });
  }

  for (const rule of pipelineData.rules) {
    const eligibleItems = activeItems.filter((indexedItem) => !indexedItem.item.stopped);
    if (eligibleItems.length === 0) break;

    const evaluations: RuleEvaluation[] = [];
    for (const indexedItem of eligibleItems) {
      const previousCategoryId = indexedItem.item.state.currentCategoryId;
      const passesScope = scopeFilterPasses(
        rule.scope_filter,
        indexedItem.item.state,
        indexedItem.item.context.line_item.category_locked_by_user,
      );
      if (!passesScope) {
        evaluations.push({
          indexedItem,
          previousCategoryId,
          matched: false,
          matchedFilterCount: 0,
          totalFilterCount: rule.filters?.length ?? 0,
          reason: `Scope filter ${rule.scope_filter} skipped the line item`,
          targetCategoryId: null,
        });
        continue;
      }

      const filterResult = evaluateRuleFilters(
        indexedItem.item.context,
        indexedItem.item.state,
        rule,
      );
      if (!filterResult.matched) {
        evaluations.push({
          indexedItem,
          previousCategoryId,
          matched: false,
          matchedFilterCount: filterResult.matchedFilterCount,
          totalFilterCount: filterResult.totalFilterCount,
          reason: "Rule filters did not match",
          targetCategoryId: null,
        });
        continue;
      }

      evaluations.push({
        indexedItem,
        previousCategoryId,
        matched: true,
        matchedFilterCount: filterResult.matchedFilterCount,
        totalFilterCount: filterResult.totalFilterCount,
        reason: "Rule matched",
        targetCategoryId: null,
      });
    }

    if (rule.rule_kind === "llm_categorization") {
      const matchedEvaluations = evaluations.filter((evaluation) => evaluation.matched);
      const llmDecisions = await resolveLlmDecisions(
        matchedEvaluations,
        rule,
        pipelineData.candidateCategories,
        deps,
      );

      for (const evaluation of evaluations) {
        const item = evaluation.indexedItem.item;
        let extraDebug: Record<string, unknown> | undefined;

        if (evaluation.matched) {
          const decision =
            llmDecisions.get(item.options.lineItemId) ??
            ({
              result: createMissingLlmResult(
                item.options.lineItemId,
                "LLM response did not include the requested line item",
              ),
              batched: false,
              batchSize: 1,
              model: null,
              promptTokens: null,
              completionTokens: null,
              fallbackMode: "retry_single_after_partial_batch",
            } satisfies LlmDecision);

          evaluation.targetCategoryId = decision.result.categoryId ?? null;
          extraDebug = {
            llm_reason: decision.result.reason ?? null,
            llm_raw_response: decision.result.rawResponse ?? null,
            llm_candidate_count: pipelineData.candidateCategories.length,
            llm_batched: decision.batched,
            llm_batch_size: decision.batchSize,
            llm_model: decision.model,
            llm_fallback_mode: decision.fallbackMode,
          };

          if (decision.batched) {
            item.usedSharedLlmBatch = true;
          } else {
            item.promptTokens += decision.promptTokens ?? 0;
            item.completionTokens += decision.completionTokens ?? 0;
          }

          if (!evaluation.targetCategoryId) {
            evaluation.reason = decision.result.reason ?? "LLM decided not to change the category";
          } else if (!pipelineData.categoriesById.has(evaluation.targetCategoryId)) {
            evaluation.targetCategoryId = null;
            evaluation.reason = "LLM returned a category outside the allowed candidate list";
          } else if (evaluation.targetCategoryId === item.state.currentCategoryId) {
            evaluation.reason =
              decision.result.reason ?? "LLM matched but category was already assigned";
          } else {
            applyCategoryChange(
              item,
              evaluation.targetCategoryId,
              pipelineData.categoriesById,
              "llm",
              rule.id,
            );
            evaluation.reason = decision.result.reason ?? "LLM selected a matching category";
          }
        }

        await recordRuleStep(evaluation, rule, deps, extraDebug);
        if (
          evaluation.previousCategoryId !== item.state.currentCategoryId &&
          rule.stop_processing
        ) {
          item.stopped = true;
        }
      }

      continue;
    }

    for (const evaluation of evaluations) {
      const item = evaluation.indexedItem.item;

      if (evaluation.matched) {
        switch (rule.rule_kind) {
          case "direct":
            evaluation.targetCategoryId = rule.target_category_id;
            if (!evaluation.targetCategoryId) {
              evaluation.reason = "Direct rule has no target category";
            } else if (evaluation.targetCategoryId === item.state.currentCategoryId) {
              evaluation.reason = "Rule matched but category was already assigned";
            } else {
              applyCategoryChange(
                item,
                evaluation.targetCategoryId,
                pipelineData.categoriesById,
                "rule",
                rule.id,
              );
              evaluation.reason = "Direct rule assigned the configured target category";
            }
            break;
          case "mcc_map": {
            const mcc = normalizeText(item.context.transaction.mcc);
            if (!mcc) {
              evaluation.reason = "No MCC mapping exists for this transaction";
              break;
            }
            if (!pipelineData.mccCache.has(mcc)) {
              pipelineData.mccCache.set(mcc, await deps.repository.findMccCanonicalCategoryId(mcc));
            }
            evaluation.targetCategoryId = pipelineData.mccCache.get(mcc) ?? null;
            if (!evaluation.targetCategoryId) {
              evaluation.reason = "No MCC mapping exists for this transaction";
            } else if (evaluation.targetCategoryId === item.state.currentCategoryId) {
              evaluation.reason = "MCC mapping matched but category was already assigned";
            } else {
              applyCategoryChange(
                item,
                evaluation.targetCategoryId,
                pipelineData.categoriesById,
                "rule",
                rule.id,
              );
              evaluation.reason = "Applied built-in MCC mapping";
            }
            break;
          }
          case "fallback_uncategorized":
            if (item.state.currentCategoryId) {
              evaluation.reason = "Fallback only runs when no category is assigned";
            } else {
              const systemKey = normalizeText(rule.config.target_system_key) ?? "uncategorized";
              const fallbackCategory = pipelineData.categories.find(
                (category) =>
                  category.category_kind === "canonical" && category.system_key === systemKey,
              );
              evaluation.targetCategoryId = fallbackCategory?.id ?? null;
              if (!evaluation.targetCategoryId) {
                evaluation.reason = "Fallback target canonical category could not be resolved";
              } else {
                applyCategoryChange(
                  item,
                  evaluation.targetCategoryId,
                  pipelineData.categoriesById,
                  "rule",
                  rule.id,
                );
                evaluation.reason = "Applied fallback canonical category";
              }
            }
            break;
          default:
            evaluation.reason = "Rule skipped";
            break;
        }
      }

      await recordRuleStep(evaluation, rule, deps);
      if (evaluation.previousCategoryId !== item.state.currentCategoryId && rule.stop_processing) {
        item.stopped = true;
      }
    }
  }

  for (const indexedItem of activeItems) {
    results[indexedItem.index] = await finalizePersistedRun(indexedItem.item, deps);
  }

  return results.filter((result): result is MoneyCategoryRuleRunResult => Boolean(result));
}

async function preparePipelineData(
  rules: MoneyCategoryRule[],
  deps: MoneyCategorizeServiceDeps,
): Promise<PreparedPipelineData> {
  const categories = await deps.repository.listCategories();
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  return {
    rules,
    categories,
    categoriesById,
    candidateCategories: buildCandidateCategories(categories, categoriesById),
    mccCache: new Map<string, string | null>(),
  };
}

async function executePipelineRuns(
  optionsList: PipelineRunOptions[],
  rules: MoneyCategoryRule[],
  deps: MoneyCategorizeServiceDeps,
): Promise<MoneyCategoryRuleRunResult[]> {
  const pipelineData = await preparePipelineData(rules, deps);
  const batchSize = resolveLlmBatchSize(deps.llmBatchSize);
  const runs: MoneyCategoryRuleRunResult[] = [];

  for (const chunk of chunkValues(optionsList, batchSize)) {
    runs.push(...(await executePipelineChunk(chunk, pipelineData, deps)));
  }

  return runs;
}

export async function previewMoneyCategoryRulePipelineService(
  input: {
    lineItemId: string;
    personId?: string | null;
    ruleIds?: string[] | null;
  },
  deps: MoneyCategorizeServiceDeps,
): Promise<MoneyCategoryRuleRunResult> {
  const rules = await deps.repository.listRules(input.personId ?? "", input.ruleIds ?? null);
  const hasLlmRules = rules.some((rule) => rule.rule_kind === "llm_categorization");

  if (!hasLlmRules) {
    return await deps.repository.runDeterministicPreview({
      lineItemId: input.lineItemId,
      personId: input.personId ?? "",
      ruleIds: input.ruleIds ?? null,
    });
  }

  const runs = await executePipelineRuns(
    [
      {
        lineItemId: input.lineItemId,
        personId: input.personId ?? "",
        ruleIds: input.ruleIds ?? null,
        save: false,
        forceOverwriteLocked: false,
        triggerSource: "single_preview",
      },
    ],
    rules,
    deps,
  );

  return runs[0];
}

export async function applyMoneyCategoryRulePipelineService(
  input: {
    lineItemIds: string[];
    personId: string;
    forceOverwriteLocked?: boolean;
    triggerSource?: string;
    triggeredByUserId?: string | null;
  },
  deps: MoneyCategorizeServiceDeps,
): Promise<{ runs: MoneyCategoryRuleRunResult[]; count: number }> {
  if (input.lineItemIds.length === 0) {
    return { runs: [], count: 0 };
  }

  const rules = await deps.repository.listRules(input.personId, null);
  const hasLlmRules = rules.some((rule) => rule.rule_kind === "llm_categorization");

  if (!hasLlmRules) {
    const deterministicResult = await deps.repository.runDeterministicApplyLineItems({
      lineItemIds: input.lineItemIds,
      personId: input.personId,
      forceOverwriteLocked: input.forceOverwriteLocked ?? false,
      triggerSource: input.triggerSource ?? "manual_replay",
    });
    if (input.triggeredByUserId) {
      const runIds = extractRunIds(deterministicResult.runs);
      if (runIds.length > 0) {
        await deps.repository.updateRunsTriggeredByUser(runIds, input.triggeredByUserId);
      }
    }
    return deterministicResult;
  }

  const runs = await executePipelineRuns(
    input.lineItemIds.map((lineItemId) => ({
      lineItemId,
      personId: input.personId,
      save: true,
      forceOverwriteLocked: input.forceOverwriteLocked ?? false,
      triggerSource: input.triggerSource ?? "manual_replay",
      triggeredByUserId: input.triggeredByUserId ?? null,
    })),
    rules,
    deps,
  );

  return { runs, count: runs.length };
}

export async function replayMoneyCategoryRulePipelineForTransactionService(
  input: {
    transactionId: string;
    personId: string;
    forceOverwriteLocked?: boolean;
    triggeredByUserId?: string | null;
  },
  deps: MoneyCategorizeServiceDeps,
): Promise<{ runs: MoneyCategoryRuleRunResult[]; count: number }> {
  const rules = await deps.repository.listRules(input.personId, null);
  const hasLlmRules = rules.some((rule) => rule.rule_kind === "llm_categorization");

  if (!hasLlmRules) {
    const deterministicResult = await deps.repository.runDeterministicReplayTransaction({
      transactionId: input.transactionId,
      personId: input.personId,
      forceOverwriteLocked: input.forceOverwriteLocked ?? false,
    });
    if (input.triggeredByUserId) {
      const runIds = extractRunIds(deterministicResult.runs);
      if (runIds.length > 0) {
        await deps.repository.updateRunsTriggeredByUser(runIds, input.triggeredByUserId);
      }
    }
    return deterministicResult;
  }

  const lineItemIds = await deps.repository.listLineItemIdsForTransaction(input.transactionId);
  return await applyMoneyCategoryRulePipelineService(
    {
      lineItemIds,
      personId: input.personId,
      forceOverwriteLocked: input.forceOverwriteLocked ?? false,
      triggerSource: "single_transaction_replay",
      triggeredByUserId: input.triggeredByUserId ?? null,
    },
    deps,
  );
}

export async function replayMoneyCategoryRulePipelineForDateRangeService(
  input: {
    personId: string;
    from: string;
    to: string;
    forceOverwriteLocked?: boolean;
    triggeredByUserId?: string | null;
  },
  deps: MoneyCategorizeServiceDeps,
): Promise<{ runs: MoneyCategoryRuleRunResult[]; count: number }> {
  const rules = await deps.repository.listRules(input.personId, null);
  const hasLlmRules = rules.some((rule) => rule.rule_kind === "llm_categorization");

  if (!hasLlmRules) {
    const deterministicResult = await deps.repository.runDeterministicReplayDateRange({
      personId: input.personId,
      from: input.from,
      to: input.to,
      forceOverwriteLocked: input.forceOverwriteLocked ?? false,
    });
    if (input.triggeredByUserId) {
      const runIds = extractRunIds(deterministicResult.runs);
      if (runIds.length > 0) {
        await deps.repository.updateRunsTriggeredByUser(runIds, input.triggeredByUserId);
      }
    }
    return deterministicResult;
  }

  const lineItemIds = await deps.repository.listLineItemIdsForDateRange(
    input.personId,
    input.from,
    input.to,
  );
  return await applyMoneyCategoryRulePipelineService(
    {
      lineItemIds,
      personId: input.personId,
      forceOverwriteLocked: input.forceOverwriteLocked ?? false,
      triggerSource: "date_range_replay",
      triggeredByUserId: input.triggeredByUserId ?? null,
    },
    deps,
  );
}

/**
 * Exposed for the conformance suite that runs the same corpus through this implementation
 * and through money_evaluate_category_rule_filter in the database. Two implementations of
 * one rule engine only stay equivalent if something checks.
 */
export const __test__ = {
  evaluateRuleFilter,
};
