// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../supabase/functions/_shared/deno.d.ts" />
/**
 * Builds the production OpenRouter money-categorize request from a fixture and runs it.
 */
import {
  buildPrompt,
  callOpenRouterMoneyCategorizeBatch,
} from "../../supabase/functions/money-categorize/openrouter-categorize.ts";
import type {
  MoneyCategorizeCandidateCategory,
  MoneyCategorizeLlmBatchRequest,
  MoneyCategoryRule,
  MoneyCategoryRuleContext,
} from "../../supabase/functions/money-categorize/service.ts";
import type { SharedCategories } from "./corpus.ts";
import type { CaseDiagnostics, CaseInput, CasePrediction } from "./types.ts";

export const DEFAULT_RULE_PROMPT =
  "Classify the line into the best matching Orbit category. Prefer null when unsure.";

export const DEFAULT_EVAL_MODEL = "google/gemini-2.0-flash-001";

export function buildRule(prompt: string = DEFAULT_RULE_PROMPT): MoneyCategoryRule {
  return {
    id: "rule-eval-llm",
    person_id: "person-eval-synthetic",
    name: "Eval LLM categorization",
    description: null,
    enabled: true,
    sort_order: 1,
    rule_kind: "llm_categorization",
    target_category_id: null,
    match_mode: "all",
    scope_filter: "all_line_items",
    filters: [],
    config: { prompt, provider: "openrouter" },
    stop_processing: false,
    created_at: null,
  };
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildContext(input: CaseInput): MoneyCategoryRuleContext {
  const quantity = input.quantity ?? 1;
  const postedAt = input.posted_at ?? "2026-03-10T10:00:00.000Z";
  const posted = new Date(postedAt);
  const absolute = Math.abs(input.amount);
  return {
    line_item: {
      id: input.line_item_id,
      transaction_id: `tx-${input.line_item_id}`,
      title: input.title,
      amount: input.amount,
      quantity,
      unit: input.unit ?? "pcs",
      line_status: "final",
      category_id: null,
      assignment_method: "import",
      assignment_rule_id: null,
      assignment_confidence: null,
      raw_payload: {},
      category_locked_by_user: false,
      last_category_rule_id: null,
      last_category_rule_run_id: null,
      category_assigned_at: null,
    },
    transaction: {
      id: `tx-${input.line_item_id}`,
      payer_person_id: "person-eval-synthetic",
      account_id: "account-eval-1",
      card_id: "card-eval-1",
      source: input.source ?? "synthetic",
      posted_at: postedAt,
      amount: input.amount,
      currency: input.currency,
      transaction_type: input.transaction_type,
      status: "posted",
      merchant_name: input.merchant_name,
      mcc: input.mcc,
      comment: input.comment ?? "",
      source_comment: "",
      source_category_id: null,
      source_category_name: null,
      cashback_amount: null,
      brand_id: input.brand_name ? `brand-${normalizeTitle(input.brand_name)}` : null,
      is_transfer: input.transaction_type === "transfer",
      raw_payload: {},
    },
    account: {
      id: "account-eval-1",
      source: input.source ?? "synthetic",
      account_kind: "debit",
      account_label: "Eval account",
    },
    card: {
      id: "card-eval-1",
      last4: "0001",
      card_label: "Eval card",
    },
    brand: {
      id: input.brand_name ? `brand-${normalizeTitle(input.brand_name)}` : null,
      name: input.brand_name ?? null,
      slug: input.brand_name ? normalizeTitle(input.brand_name).replace(/\s+/g, "-") : null,
    },
    current_category: {
      id: null,
      kind: null,
      name_en: null,
      name_ru: null,
      system_key: null,
      canonical_category_id: null,
      canonical_system_key: null,
    },
    receipt_sibling_items: (input.siblings ?? []).map((sibling) => ({
      id: sibling.id,
      title: sibling.title,
      amount: sibling.amount,
      quantity: sibling.quantity ?? 1,
      unit: sibling.unit ?? "pcs",
      line_status: "final",
      category_id: sibling.category_id ?? null,
      assignment_method: "import",
    })),
    derived: {
      normalized_line_item_title: normalizeTitle(input.title),
      normalized_merchant_name: normalizeTitle(input.merchant_name),
      absolute_line_item_amount: absolute,
      unit_price: quantity === 0 ? absolute : absolute / quantity,
      posted_day_of_week: posted.getUTCDay(),
      posted_month: posted.getUTCMonth() + 1,
      current_category_kind: null,
      current_canonical_system_key: null,
      has_receipt_metadata: (input.siblings ?? []).length > 0,
    },
  };
}

export function buildBatchRequest(
  input: CaseInput,
  candidateCategories: MoneyCategorizeCandidateCategory[],
  rulePrompt: string = DEFAULT_RULE_PROMPT,
): MoneyCategorizeLlmBatchRequest {
  return {
    rule: buildRule(rulePrompt),
    candidateCategories,
    items: [
      {
        lineItemId: input.line_item_id,
        currentCategoryId: null,
        currentCanonicalSystemKey: null,
        context: buildContext(input),
      },
    ],
  };
}

/** Exact OpenRouter chat-completions body production sends — used for cassette keys too. */
export function buildOpenRouterRequestBody(
  request: MoneyCategorizeLlmBatchRequest,
  model: string,
): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a transaction categorization engine. Output JSON only. Never invent ids outside the candidate list.",
      },
      {
        role: "user",
        content: buildPrompt(request),
      },
    ],
  };
}

export function resolveSystemKey(
  categoryId: string | null,
  shared: SharedCategories,
): string | null {
  if (!categoryId) return null;
  return shared.byId.get(categoryId)?.canonical_system_key ?? null;
}

export async function runCasePipeline(
  input: CaseInput,
  shared: SharedCategories,
  deps: {
    fetchFn: typeof fetch;
    apiKey: string;
    model: string;
    rulePrompt?: string;
  },
): Promise<{ prediction: CasePrediction; diagnostics: CaseDiagnostics }> {
  const request = buildBatchRequest(input, shared.candidateCategories, deps.rulePrompt);
  const result = await callOpenRouterMoneyCategorizeBatch(request, {
    fetchFn: deps.fetchFn,
    apiKey: deps.apiKey,
    model: deps.model,
  });

  const item =
    result.items.find((entry) => entry.lineItemId === input.line_item_id) ??
    result.items[0] ??
    null;
  const categoryId = item?.categoryId ?? null;

  return {
    prediction: {
      category_id: categoryId,
      canonical_system_key: resolveSystemKey(categoryId, shared),
      reason: item?.reason ?? null,
    },
    diagnostics: {
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      costUsd: null,
      model: result.model ?? deps.model,
    },
  };
}
