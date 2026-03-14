import type {
  MoneyCategorizeLlmBatchRequest,
  MoneyCategorizeLlmBatchResult,
  MoneyCategorizeLlmBatchResultItem,
} from "./service.ts";

export interface OpenRouterMoneyCategorizeDeps {
  fetchFn: typeof fetch;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-001";
const INVALID_BATCH_JSON_ERROR_MESSAGE = "OpenRouter returned invalid batch JSON content";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
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

function parseJsonContent(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const candidates: string[] = [];
  if (trimmed.length > 0) candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  for (const candidate of candidates) {
    try {
      return asRecord(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  throw new Error(INVALID_BATCH_JSON_ERROR_MESSAGE);
}

function buildPrompt(request: MoneyCategorizeLlmBatchRequest): string {
  return [
    "Classify each money line item into exactly one allowed category or choose no change.",
    'Return strict JSON with shape: {"items":[{"line_item_id":"...","category_id":"...|null","reason":"..."}]}',
    "category_id must be one of the provided candidate ids or null.",
    "If uncertain, keep category_id null.",
    `Rule prompt: ${JSON.stringify(request.rule.config.prompt ?? "")}`,
    `Allowed categories: ${JSON.stringify(request.candidateCategories)}`,
    `Line items: ${JSON.stringify(
      request.items.map((item) =>
        compactRecord({
          line_item_id: item.lineItemId,
          current_category_id: item.currentCategoryId,
          current_canonical_system_key: item.currentCanonicalSystemKey,
          line_item: compactRecord({
            title: item.context.line_item.title,
            amount: item.context.line_item.amount,
            quantity: item.context.line_item.quantity,
            unit: item.context.line_item.unit,
            raw_payload: item.context.line_item.raw_payload,
          }),
          transaction: compactRecord({
            source: item.context.transaction.source,
            merchant_name: item.context.transaction.merchant_name,
            posted_at: item.context.transaction.posted_at,
            transaction_type: item.context.transaction.transaction_type,
            source_category_id: item.context.transaction.source_category_id,
            source_category_name: item.context.transaction.source_category_name,
            comment: item.context.transaction.comment,
            source_comment: item.context.transaction.source_comment,
            mcc: item.context.transaction.mcc,
            is_transfer: item.context.transaction.is_transfer,
          }),
        }),
      ),
    )}`,
  ].join("\n\n");
}

function parseBatchItems(parsed: Record<string, unknown>): MoneyCategorizeLlmBatchResultItem[] {
  const items = asArray(parsed.items);
  if (items.length === 0 && !Array.isArray(parsed.items)) {
    throw new Error(INVALID_BATCH_JSON_ERROR_MESSAGE);
  }

  const results: MoneyCategorizeLlmBatchResultItem[] = [];
  const seenLineItemIds = new Set<string>();

  for (const item of items) {
    const record = asRecord(item);
    const lineItemId = asString(record.line_item_id);
    if (!lineItemId || seenLineItemIds.has(lineItemId)) continue;
    seenLineItemIds.add(lineItemId);
    results.push({
      lineItemId,
      categoryId: asString(record.category_id),
      reason: asString(record.reason),
      rawResponse: record,
    });
  }

  return results;
}

export async function callOpenRouterMoneyCategorizeBatch(
  request: MoneyCategorizeLlmBatchRequest,
  deps: OpenRouterMoneyCategorizeDeps,
): Promise<MoneyCategorizeLlmBatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await deps.fetchFn("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: deps.model ?? DEFAULT_OPENROUTER_MODEL,
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
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status}`);
    }

    const body = asRecord(await response.json());
    const choices = asArray(body.choices);
    const message = asRecord(asRecord(choices[0]).message);
    const content = message.content;
    const contentText =
      typeof content === "string"
        ? content
        : asArray(content)
            .map((part) => asString(asRecord(part).text))
            .filter((part): part is string => Boolean(part))
            .join("\n");

    const parsed = parseJsonContent(contentText);
    const usage = asRecord(body.usage);

    return {
      items: parseBatchItems(parsed),
      promptTokens: asNumber(usage.prompt_tokens),
      completionTokens: asNumber(usage.completion_tokens),
      rawResponse: parsed,
      model: deps.model ?? DEFAULT_OPENROUTER_MODEL,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("OpenRouter request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
