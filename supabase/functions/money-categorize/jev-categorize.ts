import { decideJevCategoryApplication } from "./jev-confidence.ts";
import type {
  MoneyCategorizeCandidateCategory,
  MoneyCategorizeLlmBatchRequest,
  MoneyCategorizeLlmBatchRequestItem,
  MoneyCategorizeLlmBatchResult,
  MoneyCategorizeLlmBatchResultItem,
  MoneyCategoryRuleContext,
} from "./service.ts";

export interface JevMoneyCategorizeDeps {
  fetchFn: typeof fetch;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  concurrency?: number;
  probabilityThreshold?: number;
  noulThreshold?: number;
}

/** Pinned for reproducibility (ORB-44 experiment used jev-1.14.0). */
export const DEFAULT_JEV_MODEL = "jev-1.14.0";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_BASE_URL = "https://api.typesafe.ai";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") {
        return Object.keys(asRecord(value)).length > 0;
      }
      return true;
    }),
  );
}

/** Maximum available transaction/line fields for Jev state (no secrets). */
export function buildJevState(item: MoneyCategorizeLlmBatchRequestItem): Record<string, unknown> {
  const ctx: MoneyCategoryRuleContext = item.context;
  return compactRecord({
    line_item_id: item.lineItemId,
    current_category_id: item.currentCategoryId,
    current_canonical_system_key: item.currentCanonicalSystemKey,
    line_item_title: ctx.line_item.title,
    line_item_amount: ctx.line_item.amount,
    line_item_quantity: ctx.line_item.quantity,
    line_item_unit: ctx.line_item.unit,
    line_status: ctx.line_item.line_status,
    line_raw_payload: ctx.line_item.raw_payload,
    transaction_id: ctx.transaction.id,
    posted_at: ctx.transaction.posted_at,
    amount: ctx.transaction.amount,
    currency: ctx.transaction.currency,
    transaction_type: ctx.transaction.transaction_type,
    status: ctx.transaction.status,
    merchant_name: ctx.transaction.merchant_name,
    mcc: ctx.transaction.mcc,
    comment: ctx.transaction.comment,
    source_comment: ctx.transaction.source_comment,
    source: ctx.transaction.source,
    source_category_id: ctx.transaction.source_category_id,
    source_category_name: ctx.transaction.source_category_name,
    cashback_amount: ctx.transaction.cashback_amount,
    is_transfer: ctx.transaction.is_transfer,
    account_source: ctx.account.source,
    account_kind: ctx.account.account_kind,
    normalized_line_item_title: ctx.derived.normalized_line_item_title,
    normalized_merchant_name: ctx.derived.normalized_merchant_name,
    has_receipt_metadata: ctx.derived.has_receipt_metadata,
  });
}

function buildChoiceCriteria(
  candidates: MoneyCategorizeCandidateCategory[],
): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const candidate of candidates) {
    // Choice keys must be the category UUID so the response maps directly to categoryId.
    // Skip meta buckets that should not be auto-assigned.
    const systemKey = candidate.canonical_system_key;
    if (systemKey === "uncategorized" || systemKey === "needs_review") continue;
    criteria[candidate.id] = `${candidate.name_ru} / ${candidate.name_en}${
      systemKey ? ` (${systemKey})` : ""
    }`;
  }
  return criteria;
}

function buildQuestions(
  candidates: MoneyCategorizeCandidateCategory[],
  userPrompt: string | null,
): Record<string, unknown> {
  const instructions = [
    "Выбери одну категорию Orbit для этой банковской строки транзакции.",
    "Учитывай merchant, сумму, MCC, комментарий, название строки и категорию банка если есть.",
    userPrompt ? `Дополнительная инструкция пользователя: ${userPrompt}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  return {
    category: {
      type: "choice",
      instructions,
      criteria: buildChoiceCriteria(candidates),
    },
    any_fit: {
      type: "noul",
      instructions:
        "Подходит ли хотя бы одна из предложенных категорий уверенно? Нет — если перевод себе, данных недостаточно, или ни одна опция не подходит.",
    },
  };
}

async function mapPool<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  const workers = Math.max(1, Math.min(concurrency, values.length || 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function callJevOnce(
  item: MoneyCategorizeLlmBatchRequestItem,
  request: MoneyCategorizeLlmBatchRequest,
  deps: JevMoneyCategorizeDeps,
): Promise<{
  item: MoneyCategorizeLlmBatchResultItem;
  promptTokens: number;
  completionTokens: number;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = deps.model ?? DEFAULT_JEV_MODEL;
  const userPrompt =
    typeof request.rule.config.prompt === "string" && request.rule.config.prompt.trim().length > 0
      ? request.rule.config.prompt.trim()
      : null;

  try {
    const response = await deps.fetchFn(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        state: buildJevState(item),
        questions: buildQuestions(request.candidateCategories, userPrompt),
      }),
    });

    if (!response.ok) {
      // Never echo response bodies (may reflect state); status only.
      throw new Error(`Jev request failed: ${response.status}`);
    }

    const body = asRecord(await response.json());
    const answers = asRecord(body.answers);
    const categoryAnswer = asRecord(answers.category);
    const noulAnswer = asRecord(answers.any_fit);
    const choice = asString(categoryAnswer.choice);
    const probabilities = asRecord(categoryAnswer.probabilities);
    const choiceProbability = choice ? asNumber(probabilities[choice]) : null;
    const noul = asNumber(noulAnswer.noul);
    const usage = asRecord(body.usage);

    const decision = decideJevCategoryApplication({
      choice,
      choiceProbability,
      noul,
      probabilityThreshold: deps.probabilityThreshold,
      noulThreshold: deps.noulThreshold,
    });

    const allowedIds = new Set(
      request.candidateCategories
        .filter((candidate) => {
          const key = candidate.canonical_system_key;
          return key !== "uncategorized" && key !== "needs_review";
        })
        .map((candidate) => candidate.id),
    );

    let categoryId: string | null = null;
    let reason = decision.reason;
    if (decision.apply && choice && allowedIds.has(choice)) {
      categoryId = choice;
    } else if (decision.apply && choice && !allowedIds.has(choice)) {
      categoryId = null;
      reason = "Jev returned a category outside the allowed candidate list";
    }

    return {
      item: {
        lineItemId: item.lineItemId,
        categoryId,
        reason,
        rawResponse: {
          choice,
          choice_probability: choiceProbability,
          noul,
          confidence: asNumber(categoryAnswer.confidence),
          apply: decision.apply,
          probability_threshold: decision.probabilityThreshold,
          noul_threshold: decision.noulThreshold,
        },
      },
      promptTokens: asNumber(usage.input_tokens) ?? 0,
      completionTokens: asNumber(usage.output_tokens) ?? 0,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Jev request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Jev evaluates one state per request. Preserve the batch service contract by
 * fan-out with a bounded concurrency pool.
 */
export async function callJevMoneyCategorizeBatch(
  request: MoneyCategorizeLlmBatchRequest,
  deps: JevMoneyCategorizeDeps,
): Promise<MoneyCategorizeLlmBatchResult> {
  const criteria = buildChoiceCriteria(request.candidateCategories);
  if (Object.keys(criteria).length === 0) {
    return {
      items: request.items.map((item) => ({
        lineItemId: item.lineItemId,
        categoryId: null,
        reason: "No eligible candidate categories for Jev Choice",
        rawResponse: null,
      })),
      promptTokens: 0,
      completionTokens: 0,
      model: deps.model ?? DEFAULT_JEV_MODEL,
    };
  }

  if (Object.keys(criteria).length > 255) {
    throw new Error("Jev Choice supports at most 255 category options");
  }

  const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  const settled = await mapPool(request.items, concurrency, async (item) =>
    callJevOnce(item, request, deps),
  );

  return {
    items: settled.map((entry) => entry.item),
    promptTokens: settled.reduce((sum, entry) => sum + entry.promptTokens, 0),
    completionTokens: settled.reduce((sum, entry) => sum + entry.completionTokens, 0),
    model: deps.model ?? DEFAULT_JEV_MODEL,
  };
}
