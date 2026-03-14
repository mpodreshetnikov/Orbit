// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import {
  applyMoneyCategoryRulePipelineService,
  type MoneyCategorizeLlmBatchRequest,
  type MoneyCategorizeLlmBatchResult,
  type MoneyCategorizeServiceDeps,
  type MoneyCategory,
  type MoneyCategoryRule,
  type MoneyCategoryRuleContext,
  type MoneyCategoryRuleRunResult,
} from "./service.ts";

const DEFAULT_CATEGORIES: MoneyCategory[] = [
  {
    id: "cat-food",
    parent_id: null,
    canonical_category_id: "cat-food",
    category_kind: "canonical",
    system_key: "food",
    sort_order: 1,
    created_by: null,
    depth: 1,
    name_en: "Food",
    name_ru: "Еда",
    slug: "food",
    archived_at: null,
  },
  {
    id: "cat-coffee",
    parent_id: null,
    canonical_category_id: "cat-food",
    category_kind: "custom",
    system_key: null,
    sort_order: 2,
    created_by: null,
    depth: 1,
    name_en: "Coffee",
    name_ru: "Кофе",
    slug: "coffee",
    archived_at: null,
  },
  {
    id: "cat-uncategorized",
    parent_id: null,
    canonical_category_id: "cat-uncategorized",
    category_kind: "canonical",
    system_key: "uncategorized",
    sort_order: 99,
    created_by: null,
    depth: 1,
    name_en: "Uncategorized",
    name_ru: "Без категории",
    slug: "uncategorized",
    archived_at: null,
  },
];

function createRule(
  input: Pick<MoneyCategoryRule, "id" | "name" | "rule_kind" | "sort_order"> &
    Partial<MoneyCategoryRule>,
): MoneyCategoryRule {
  return {
    id: input.id,
    person_id: input.person_id ?? "person-1",
    name: input.name,
    description: input.description ?? null,
    enabled: input.enabled ?? true,
    sort_order: input.sort_order,
    rule_kind: input.rule_kind,
    target_category_id: input.target_category_id ?? null,
    match_mode: input.match_mode ?? "all",
    scope_filter: input.scope_filter ?? "all_line_items",
    filters: input.filters ?? [],
    config: input.config ?? {},
    stop_processing: input.stop_processing ?? false,
    created_at: input.created_at ?? null,
  };
}

function createContext(input: {
  lineItemId: string;
  transactionId?: string;
  title?: string;
  amount?: number;
  merchantName?: string;
  mcc?: string | null;
  currentCategoryId?: string | null;
  currentCategoryKind?: MoneyCategory["category_kind"] | null;
  currentCanonicalCategoryId?: string | null;
  currentCanonicalSystemKey?: string | null;
  locked?: boolean;
}): MoneyCategoryRuleContext {
  const transactionId = input.transactionId ?? `tx-${input.lineItemId}`;
  const currentCategoryId = input.currentCategoryId ?? null;
  const currentCategoryKind = input.currentCategoryKind ?? null;
  const currentCanonicalCategoryId = input.currentCanonicalCategoryId ?? null;
  const currentCanonicalSystemKey = input.currentCanonicalSystemKey ?? null;

  return {
    line_item: {
      id: input.lineItemId,
      transaction_id: transactionId,
      title: input.title ?? `Item ${input.lineItemId}`,
      amount: input.amount ?? 450,
      quantity: 1,
      unit: "pcs",
      line_status: "final",
      category_id: currentCategoryId,
      assignment_method: "import",
      assignment_rule_id: null,
      assignment_confidence: null,
      raw_payload: {},
      category_locked_by_user: input.locked ?? false,
      last_category_rule_id: null,
      last_category_rule_run_id: null,
      category_assigned_at: null,
    },
    transaction: {
      id: transactionId,
      payer_person_id: "person-1",
      account_id: "account-1",
      source: "tbank",
      posted_at: "2026-03-10T10:00:00.000Z",
      amount: input.amount ?? 450,
      currency: "RUB",
      transaction_type: "expense",
      status: "posted",
      merchant_name: input.merchantName ?? "Coffee House",
      mcc: input.mcc ?? "5814",
      comment: "",
      source_comment: "",
      source_category_id: "coffee",
      source_category_name: "Coffee",
      cashback_amount: null,
      brand_id: null,
      is_transfer: false,
      raw_payload: {},
    },
    account: {
      source: "tbank",
      account_kind: "debit",
    },
    current_category: {
      id: currentCategoryId,
      kind: currentCategoryKind,
      canonical_category_id: currentCanonicalCategoryId,
      canonical_system_key: currentCanonicalSystemKey,
    },
    derived: {
      normalized_line_item_title: (input.title ?? `Item ${input.lineItemId}`).toLowerCase(),
      normalized_merchant_name: (input.merchantName ?? "Coffee House").toLowerCase(),
      absolute_line_item_amount: input.amount ?? 450,
      unit_price: input.amount ?? 450,
      posted_day_of_week: 2,
      posted_month: 3,
      current_category_kind: currentCategoryKind,
      current_canonical_system_key: currentCanonicalSystemKey,
      has_receipt_metadata: true,
    },
  };
}

interface TestState {
  createdRuns: Array<Record<string, unknown>>;
  createdSteps: Array<Record<string, unknown>>;
  finalizedRuns: Array<Record<string, unknown>>;
  patchedRuns: Array<{ runIds: string[]; triggeredByUserId: string }>;
  batchCalls: Array<{ ruleId: string; itemIds: string[] }>;
  deterministicCalls: number;
  mccLookups: number;
}

function createDefaultBatchResult(
  request: MoneyCategorizeLlmBatchRequest,
): MoneyCategorizeLlmBatchResult {
  return {
    items: request.items.map((item) => ({
      lineItemId: item.lineItemId,
      categoryId: null,
      reason: "unused",
    })),
    model: "test-model",
  };
}

function createDeps(options: {
  rules: MoneyCategoryRule[];
  contexts?: Record<string, MoneyCategoryRuleContext>;
  categories?: MoneyCategory[];
  llmBatchSize?: number;
  deterministicApplyResult?: {
    runs: MoneyCategoryRuleRunResult[];
    count: number;
  };
  mccLookupResult?: string | null;
  batchCategorize?: (
    request: MoneyCategorizeLlmBatchRequest,
    state: TestState,
  ) => Promise<MoneyCategorizeLlmBatchResult>;
}): { deps: MoneyCategorizeServiceDeps; state: TestState } {
  const state: TestState = {
    createdRuns: [],
    createdSteps: [],
    finalizedRuns: [],
    patchedRuns: [],
    batchCalls: [],
    deterministicCalls: 0,
    mccLookups: 0,
  };
  const contexts = options.contexts ?? {
    "line-1": createContext({
      lineItemId: "line-1",
      title: "Flat white",
    }),
  };

  const deps: MoneyCategorizeServiceDeps = {
    llmBatchSize: options.llmBatchSize,
    repository: {
      listRules: async () => options.rules,
      getLineItemContext: async (lineItemId: string) => contexts[lineItemId] ?? null,
      listCategories: async () => options.categories ?? DEFAULT_CATEGORIES,
      findMccCanonicalCategoryId: async () => {
        state.mccLookups += 1;
        return options.mccLookupResult ?? null;
      },
      createRuleRun: async (payload: Record<string, unknown>) => {
        state.createdRuns.push(payload);
        return `run-${state.createdRuns.length}`;
      },
      createRuleRunStep: async (payload: Record<string, unknown>) => {
        state.createdSteps.push(payload);
        return `step-${state.createdSteps.length}`;
      },
      finalizeRuleRun: async (payload: Record<string, unknown>) => {
        state.finalizedRuns.push(payload);
      },
      listLineItemIdsForTransaction: async () => [],
      listLineItemIdsForDateRange: async () => [],
      runDeterministicPreview: async () => {
        throw new Error("deterministic preview should not run");
      },
      runDeterministicApplyLineItems: async () => {
        state.deterministicCalls += 1;
        if (!options.deterministicApplyResult) {
          throw new Error("deterministic apply should not run");
        }
        return options.deterministicApplyResult;
      },
      runDeterministicReplayTransaction: async () => {
        throw new Error("deterministic replay should not run");
      },
      runDeterministicReplayDateRange: async () => {
        throw new Error("deterministic date-range replay should not run");
      },
      updateRunsTriggeredByUser: async (runIds: string[], triggeredByUserId: string) => {
        state.patchedRuns.push({ runIds, triggeredByUserId });
      },
    },
    categorizeWithLlmBatch: async (request: MoneyCategorizeLlmBatchRequest) => {
      state.batchCalls.push({
        ruleId: request.rule.id,
        itemIds: request.items.map((item) => item.lineItemId),
      });
      if (options.batchCategorize) {
        return await options.batchCategorize(request, state);
      }
      return createDefaultBatchResult(request);
    },
  };

  return { deps, state };
}

function buildContexts(lineItemIds: string[]): Record<string, MoneyCategoryRuleContext> {
  return Object.fromEntries(
    lineItemIds.map((lineItemId) => [lineItemId, createContext({ lineItemId })]),
  );
}

function getRunIdForLineItem(state: TestState, lineItemId: string): string | null {
  for (let index = 0; index < state.createdRuns.length; index += 1) {
    if (state.createdRuns[index]?.line_item_id === lineItemId) {
      return `run-${index + 1}`;
    }
  }
  return null;
}

function getStepForLineItem(
  state: TestState,
  lineItemId: string,
  ruleId: string,
): Record<string, unknown> | null {
  const runId = getRunIdForLineItem(state, lineItemId);
  if (!runId) return null;
  return (
    state.createdSteps.find((step) => step.rule_run_id === runId && step.rule_id === ruleId) ?? null
  );
}

Deno.test(
  "applyMoneyCategoryRulePipelineService distinguishes contains-any and equals-any set filters",
  async () => {
    const { deps, state } = createDeps({
      rules: [
        createRule({
          id: "rule-equals-any",
          name: "Exact merchant set",
          rule_kind: "direct",
          sort_order: 1,
          target_category_id: "cat-food",
          filters: [
            {
              field: "merchant_name",
              operator: "equals_any_in_set",
              values: ["coffee", "market"],
            },
          ],
        }),
        createRule({
          id: "rule-contains-any",
          name: "Merchant contains set",
          rule_kind: "direct",
          sort_order: 2,
          target_category_id: "cat-coffee",
          filters: [
            {
              field: "merchant_name",
              operator: "contains_any_in_set",
              values: ["coffee", "market"],
            },
          ],
          stop_processing: true,
        }),
        createRule({
          id: "rule-llm",
          name: "Unused llm",
          rule_kind: "llm_categorization",
          sort_order: 3,
          config: { prompt: "unused" },
        }),
      ],
      contexts: {
        "line-1": createContext({
          lineItemId: "line-1",
          title: "Flat white",
          merchantName: "Coffee House",
        }),
      },
    });

    const result = await applyMoneyCategoryRulePipelineService(
      {
        lineItemIds: ["line-1"],
        personId: "person-1",
        forceOverwriteLocked: false,
        triggerSource: "single_line_item_replay",
      },
      deps,
    );

    assertEquals(result.runs[0]?.final_category_id, "cat-coffee");
    assertEquals(state.createdSteps.length, 2);
    assertEquals(state.batchCalls.length, 0);
    assertEquals(state.createdSteps[0]?.rule_name, "Exact merchant set");
    assertEquals(state.createdSteps[0]?.matched, false);
    assertEquals(state.createdSteps[0]?.changed_category, false);
    assertEquals(state.createdSteps[1]?.rule_name, "Merchant contains set");
    assertEquals(state.createdSteps[1]?.matched, true);
    assertEquals(state.createdSteps[1]?.changed_category, true);
    assertEquals(state.createdSteps[1]?.next_category_id, "cat-coffee");
  },
);

Deno.test(
  "applyMoneyCategoryRulePipelineService runs a single-item LLM batch and persists debug history",
  async () => {
    const { deps, state } = createDeps({
      rules: [
        createRule({
          id: "rule-direct",
          name: "Coffee merchants",
          rule_kind: "direct",
          sort_order: 1,
          target_category_id: "cat-food",
          filters: [
            {
              field: "merchant_name",
              operator: "contains",
              value: "coffee",
            },
          ],
        }),
        createRule({
          id: "rule-llm",
          name: "Coffee detail",
          rule_kind: "llm_categorization",
          sort_order: 2,
          config: {
            prompt: "Prefer a drink-specific category when it exists.",
          },
        }),
        createRule({
          id: "rule-fallback",
          name: "Fallback uncategorized",
          rule_kind: "fallback_uncategorized",
          sort_order: 3,
          config: { target_system_key: "uncategorized" },
        }),
      ],
      contexts: {
        "line-1": createContext({
          lineItemId: "line-1",
          title: "Flat white",
          merchantName: "Coffee House",
        }),
      },
      batchCategorize: async (request) => ({
        items: request.items.map((item) => ({
          lineItemId: item.lineItemId,
          categoryId: "cat-coffee",
          reason: "Drink-specific category available",
        })),
        promptTokens: 42,
        completionTokens: 9,
        model: "google/gemini-2.0-flash-001",
      }),
    });

    const result = await applyMoneyCategoryRulePipelineService(
      {
        lineItemIds: ["line-1"],
        personId: "person-1",
        forceOverwriteLocked: false,
        triggerSource: "single_line_item_replay",
        triggeredByUserId: "user-1",
      },
      deps,
    );

    const llmDebug = (state.createdSteps[1]?.debug_payload as Record<string, unknown>) ?? {};

    assertEquals(result.count, 1);
    assertEquals(result.runs[0]?.final_category_id, "cat-coffee");
    assertEquals(result.runs[0]?.line_item_title, "Flat white");
    assertEquals(result.runs[0]?.merchant_name, "Coffee House");
    assertEquals(state.createdRuns[0]?.triggered_by_user_id, "user-1");
    assertEquals(state.createdRuns[0]?.trigger_source, "single_line_item_replay");
    assertEquals(state.batchCalls, [
      {
        ruleId: "rule-llm",
        itemIds: ["line-1"],
      },
    ]);
    assertEquals(state.createdSteps.length, 3);
    assertEquals(state.createdSteps[0]?.rule_name, "Coffee merchants");
    assertEquals(state.createdSteps[1]?.rule_kind, "llm_categorization");
    assertEquals(state.createdSteps[0]?.next_category_id, "cat-food");
    assertEquals(state.createdSteps[1]?.next_category_id, "cat-coffee");
    assertEquals(state.createdSteps[1]?.decision_reason, "Drink-specific category available");
    assertEquals(state.createdSteps[2]?.changed_category, false);
    assertEquals(state.finalizedRuns[0]?.final_category_id, "cat-coffee");
    assertEquals(state.finalizedRuns[0]?.saved, true);
    assertEquals(state.finalizedRuns[0]?.last_assignment_method, "llm");
    assertEquals(state.finalizedRuns[0]?.last_changed_rule_id, "rule-llm");
    assertEquals(state.finalizedRuns[0]?.llm_tokens_prompt, 42);
    assertEquals(state.finalizedRuns[0]?.llm_tokens_completion, 9);
    assertEquals(llmDebug.llm_batched, false);
    assertEquals(llmDebug.llm_batch_size, 1);
    assertEquals(llmDebug.llm_model, "google/gemini-2.0-flash-001");
  },
);

Deno.test(
  "applyMoneyCategoryRulePipelineService delegates deterministic runs and patches triggered_by_user_id",
  async () => {
    const { deps, state } = createDeps({
      rules: [
        createRule({
          id: "rule-direct",
          name: "Transport",
          rule_kind: "direct",
          sort_order: 1,
          target_category_id: "cat-transport",
        }),
      ],
      deterministicApplyResult: {
        runs: [
          {
            run_id: "run-deterministic",
            line_item_id: "line-1",
            line_item_title: "Flat white",
            transaction_id: "tx-1",
            merchant_name: "Coffee House",
            person_id: "person-1",
            trigger_source: "single_line_item_replay",
            starting_category_id: null,
            final_category_id: "cat-transport",
            saved: true,
            llm_tokens_prompt: null,
            llm_tokens_completion: null,
            steps: [],
          },
        ],
        count: 1,
      },
    });

    const result = await applyMoneyCategoryRulePipelineService(
      {
        lineItemIds: ["line-1"],
        personId: "person-1",
        forceOverwriteLocked: true,
        triggerSource: "single_line_item_replay",
        triggeredByUserId: "user-2",
      },
      deps,
    );

    assertEquals(result.count, 1);
    assertEquals(state.deterministicCalls, 1);
    assertEquals(state.batchCalls.length, 0);
    assertEquals(state.patchedRuns, [
      {
        runIds: ["run-deterministic"],
        triggeredByUserId: "user-2",
      },
    ]);
  },
);

Deno.test(
  "applyMoneyCategoryRulePipelineService applies mcc_map rules in the edge-function path",
  async () => {
    const { deps, state } = createDeps({
      rules: [
        createRule({
          id: "rule-mcc",
          name: "MCC",
          rule_kind: "mcc_map",
          sort_order: 1,
          stop_processing: true,
        }),
        createRule({
          id: "rule-llm",
          name: "No-op llm",
          rule_kind: "llm_categorization",
          sort_order: 2,
          config: { prompt: "unused" },
        }),
      ],
      mccLookupResult: "cat-food",
    });

    const result = await applyMoneyCategoryRulePipelineService(
      {
        lineItemIds: ["line-1"],
        personId: "person-1",
        triggerSource: "single_line_item_replay",
      },
      deps,
    );

    assertEquals(result.count, 1);
    assertEquals(result.runs[0]?.final_category_id, "cat-food");
    assertEquals(result.runs[0]?.line_item_title, "Flat white");
    assertEquals(result.runs[0]?.merchant_name, "Coffee House");
    assertEquals(state.mccLookups, 1);
    assertEquals(state.batchCalls.length, 0);
    assertEquals(state.createdSteps.length, 1);
    assertEquals(state.createdSteps[0]?.rule_kind, "mcc_map");
    assertEquals(state.createdSteps[0]?.changed_category, true);
    assertEquals(state.createdSteps[0]?.decision_reason, "Applied built-in MCC mapping");
  },
);

Deno.test(
  "applyMoneyCategoryRulePipelineService batches eight line items into two LLM requests of four",
  async () => {
    const lineItemIds = Array.from({ length: 8 }, (_, index) => `line-${index + 1}`);
    const { deps, state } = createDeps({
      rules: [
        createRule({
          id: "rule-llm",
          name: "Categorize drinks",
          rule_kind: "llm_categorization",
          sort_order: 1,
          config: { prompt: "Use the most specific category." },
        }),
      ],
      contexts: buildContexts(lineItemIds),
      batchCategorize: async (request) => ({
        items: request.items.map((item) => ({
          lineItemId: item.lineItemId,
          categoryId: "cat-coffee",
          reason: "Batch categorized",
        })),
        promptTokens: 300,
        completionTokens: 24,
        model: "google/gemini-2.0-flash-001",
      }),
    });

    const result = await applyMoneyCategoryRulePipelineService(
      {
        lineItemIds,
        personId: "person-1",
        triggerSource: "import_auto",
      },
      deps,
    );

    const llmSteps = state.createdSteps.filter((step) => step.rule_id === "rule-llm");
    const firstDebug = (llmSteps[0]?.debug_payload as Record<string, unknown>) ?? {};

    assertEquals(result.count, 8);
    assertEquals(state.batchCalls, [
      {
        ruleId: "rule-llm",
        itemIds: ["line-1", "line-2", "line-3", "line-4"],
      },
      {
        ruleId: "rule-llm",
        itemIds: ["line-5", "line-6", "line-7", "line-8"],
      },
    ]);
    assertEquals(llmSteps.length, 8);
    assertEquals(firstDebug.llm_batched, true);
    assertEquals(firstDebug.llm_batch_size, 4);
    assertEquals(firstDebug.llm_model, "google/gemini-2.0-flash-001");
    assertEquals(
      state.finalizedRuns.map((run) => run.llm_tokens_prompt),
      [null, null, null, null, null, null, null, null],
    );
    assertEquals(
      state.finalizedRuns.map((run) => run.llm_tokens_completion),
      [null, null, null, null, null, null, null, null],
    );
  },
);

Deno.test("applyMoneyCategoryRulePipelineService batches once per llm rule per chunk", async () => {
  const lineItemIds = ["line-1", "line-2", "line-3", "line-4"];
  const { deps, state } = createDeps({
    rules: [
      createRule({
        id: "rule-llm-primary",
        name: "Primary llm",
        rule_kind: "llm_categorization",
        sort_order: 1,
        config: { prompt: "Pick the branch." },
      }),
      createRule({
        id: "rule-llm-secondary",
        name: "Secondary llm",
        rule_kind: "llm_categorization",
        sort_order: 2,
        config: { prompt: "Refine to the best leaf." },
      }),
    ],
    contexts: buildContexts(lineItemIds),
    batchCategorize: async (request) => ({
      items: request.items.map((item) => ({
        lineItemId: item.lineItemId,
        categoryId: request.rule.id === "rule-llm-primary" ? "cat-food" : "cat-coffee",
        reason: request.rule.id === "rule-llm-primary" ? "Primary batch" : "Secondary batch",
      })),
      model: "google/gemini-2.0-flash-001",
    }),
  });

  const result = await applyMoneyCategoryRulePipelineService(
    {
      lineItemIds,
      personId: "person-1",
      triggerSource: "date_range_replay",
    },
    deps,
  );

  assertEquals(result.count, 4);
  assertEquals(state.batchCalls, [
    {
      ruleId: "rule-llm-primary",
      itemIds: ["line-1", "line-2", "line-3", "line-4"],
    },
    {
      ruleId: "rule-llm-secondary",
      itemIds: ["line-1", "line-2", "line-3", "line-4"],
    },
  ]);
  assertEquals(
    result.runs.map((run) => run.final_category_id),
    ["cat-coffee", "cat-coffee", "cat-coffee", "cat-coffee"],
  );
});

Deno.test(
  "applyMoneyCategoryRulePipelineService retries missing batch results as single-item requests",
  async () => {
    const lineItemIds = ["line-1", "line-2", "line-3", "line-4"];
    const { deps, state } = createDeps({
      rules: [
        createRule({
          id: "rule-llm",
          name: "Partial batch llm",
          rule_kind: "llm_categorization",
          sort_order: 1,
          config: { prompt: "Return every item." },
        }),
      ],
      contexts: buildContexts(lineItemIds),
      batchCategorize: async (request) => {
        if (request.items.length > 1) {
          return {
            items: request.items
              .filter((item) => item.lineItemId !== "line-4")
              .map((item) => ({
                lineItemId: item.lineItemId,
                categoryId: "cat-coffee",
                reason: "Batch result",
              })),
            model: "test-model",
          };
        }

        return {
          items: request.items.map((item) => ({
            lineItemId: item.lineItemId,
            categoryId: "cat-coffee",
            reason: "Single retry",
          })),
          promptTokens: 12,
          completionTokens: 4,
          model: "test-model",
        };
      },
    });

    const result = await applyMoneyCategoryRulePipelineService(
      {
        lineItemIds,
        personId: "person-1",
        triggerSource: "import_auto",
      },
      deps,
    );

    const retriedStep = getStepForLineItem(state, "line-4", "rule-llm");
    const retriedDebug = (retriedStep?.debug_payload as Record<string, unknown>) ?? {};

    assertEquals(result.count, 4);
    assertEquals(state.batchCalls, [
      { ruleId: "rule-llm", itemIds: ["line-1", "line-2", "line-3", "line-4"] },
      { ruleId: "rule-llm", itemIds: ["line-4"] },
    ]);
    assertEquals(
      result.runs.map((run) => run.final_category_id),
      ["cat-coffee", "cat-coffee", "cat-coffee", "cat-coffee"],
    );
    assertEquals(retriedDebug.llm_fallback_mode, "retry_single_after_partial_batch");
  },
);

Deno.test(
  "applyMoneyCategoryRulePipelineService retries failed batch chunks as single-item requests",
  async () => {
    const lineItemIds = ["line-1", "line-2", "line-3", "line-4"];
    const { deps, state } = createDeps({
      rules: [
        createRule({
          id: "rule-llm",
          name: "Failure fallback llm",
          rule_kind: "llm_categorization",
          sort_order: 1,
          config: { prompt: "Retry on request failure." },
        }),
      ],
      contexts: buildContexts(lineItemIds),
      batchCategorize: async (request) => {
        if (request.items.length > 1) {
          throw new Error("batch exploded");
        }

        return {
          items: request.items.map((item) => ({
            lineItemId: item.lineItemId,
            categoryId: "cat-food",
            reason: "Single fallback",
          })),
          promptTokens: 5,
          completionTokens: 2,
          model: "test-model",
        };
      },
    });

    const result = await applyMoneyCategoryRulePipelineService(
      {
        lineItemIds,
        personId: "person-1",
        triggerSource: "date_range_replay",
      },
      deps,
    );

    const firstStep = getStepForLineItem(state, "line-1", "rule-llm");
    const firstDebug = (firstStep?.debug_payload as Record<string, unknown>) ?? {};

    assertEquals(result.count, 4);
    assertEquals(state.batchCalls, [
      { ruleId: "rule-llm", itemIds: ["line-1", "line-2", "line-3", "line-4"] },
      { ruleId: "rule-llm", itemIds: ["line-1"] },
      { ruleId: "rule-llm", itemIds: ["line-2"] },
      { ruleId: "rule-llm", itemIds: ["line-3"] },
      { ruleId: "rule-llm", itemIds: ["line-4"] },
    ]);
    assertEquals(
      result.runs.map((run) => run.final_category_id),
      ["cat-food", "cat-food", "cat-food", "cat-food"],
    );
    assertEquals(firstDebug.llm_fallback_mode, "retry_single_after_batch_failure");
  },
);
