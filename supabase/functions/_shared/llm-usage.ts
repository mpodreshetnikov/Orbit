/**
 * What a model call cost, read off the provider's `usage` object.
 *
 * Every field is nullable and null always means "the provider did not say", never zero: a
 * replayed cassette recorded before usage accounting existed, and a provider that does not
 * price the call, both arrive here as null. Summing treats null as absent rather than as 0,
 * so a partly-reported pipeline does not read as a cheaper one.
 */
export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  /** What the router charged for this call, in USD. Null when unknown -- never assume zero. */
  costUsd: number | null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function emptyLlmUsage(): LlmUsage {
  return { promptTokens: null, completionTokens: null, costUsd: null };
}

/** Read the OpenRouter/OpenAI-shaped `usage` object off a response body. */
export function parseLlmUsage(responseBody: unknown): LlmUsage {
  const usage = asRecord(asRecord(responseBody).usage);
  return {
    promptTokens: asNumberOrNull(usage.prompt_tokens),
    completionTokens: asNumberOrNull(usage.completion_tokens),
    costUsd: asNumberOrNull(usage.cost),
  };
}

export function sumLlmUsage(parts: LlmUsage[]): LlmUsage {
  let prompt: number | null = null;
  let completion: number | null = null;
  let cost: number | null = null;
  for (const part of parts) {
    if (part.promptTokens !== null) prompt = (prompt ?? 0) + part.promptTokens;
    if (part.completionTokens !== null) completion = (completion ?? 0) + part.completionTokens;
    if (part.costUsd !== null) cost = (cost ?? 0) + part.costUsd;
  }
  return { promptTokens: prompt, completionTokens: completion, costUsd: cost };
}

/**
 * Usage as span attributes. Absent values are omitted rather than sent as 0, so a dashboard
 * that averages them is not dragged down by calls whose cost was never reported.
 */
export function usageAttrs(usage: LlmUsage): Record<string, number> {
  const attrs: Record<string, number> = {};
  if (usage.promptTokens !== null) attrs.llm_prompt_tokens = usage.promptTokens;
  if (usage.completionTokens !== null) attrs.llm_completion_tokens = usage.completionTokens;
  if (usage.costUsd !== null) attrs.llm_cost_usd = usage.costUsd;
  return attrs;
}
