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

/**
 * Total the cost of calls that were actually made.
 *
 * One unknown component makes that component of the total unknown, because a total is read as
 * the whole cost: summing only the parts that reported would publish a confident number that is
 * quietly too low. Pass in the calls that happened and nothing else -- a stage that was skipped
 * has no cost to be unknown about, and including its placeholder would poison the total.
 */
export function sumLlmUsage(parts: LlmUsage[]): LlmUsage {
  if (parts.length === 0) return emptyLlmUsage();
  const total = (pick: (usage: LlmUsage) => number | null): number | null => {
    let sum = 0;
    for (const part of parts) {
      const value = pick(part);
      if (value === null) return null;
      sum += value;
    }
    return sum;
  };
  return {
    promptTokens: total((usage) => usage.promptTokens),
    completionTokens: total((usage) => usage.completionTokens),
    costUsd: total((usage) => usage.costUsd),
  };
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
