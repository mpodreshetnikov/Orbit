import {
  extractContentText,
  INVALID_JSON_ERROR_MESSAGE,
  parseJsonObject,
} from "../../_shared/llm-json.ts";
import {
  isRetryableStatus,
  parseRetryAfterMs,
  RetryableLlmError,
  withLlmRetry,
} from "../../_shared/llm-retry.ts";
import type { StageContext, StageUsage } from "./types.ts";

/**
 * 60s was marginal for a real document: the three-specimen histology case in the eval corpus
 * exceeded it once and then completed in 44s on the retry. Only `extract` carries a raised
 * reasoning budget (see `stages/index.ts`), so extraction is the only slow stage — but a single
 * default is simpler than a per-stage table, and `ctx.timeoutMs` already lets a deployment
 * override it via `OPENROUTER_HEALTH_STRUCTURE_TIMEOUT_MS`.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Sent on every stage request so OpenRouter does not reserve the model's full output capacity.
 *
 * Without `max_tokens` the router reserves the model's maximum completion — 65,536 tokens for the
 * gpt-5.x family — against the account's remaining credit *before* dispatching, and refuses with
 * HTTP 402 ("You requested up to 65536 tokens, but can only afford …") whenever the balance is
 * below that reservation, even though the real completion costs a fraction of a cent. A small
 * request on the same key still succeeds, which makes the failure look like a routing bug.
 *
 * 16,000 is roughly four times the largest completion observed on the eval corpus (~4,000) and far
 * below the reservation that trips the limit. Undersizing it is not silent: a truncated answer
 * comes back with `finish_reason: "length"`, which is raised as `RetryableLlmError` below.
 */
const DEFAULT_MAX_TOKENS = 16_000;

export { INVALID_JSON_ERROR_MESSAGE, parseJsonObject };
export const TRUNCATED_ERROR_MESSAGE = "OpenRouter response was truncated before completion";

export interface StageCallResult {
  parsed: Record<string, unknown>;
  usage: StageUsage;
  finishReason: string | null;
  attempts: number;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Issue one stage request and return its parsed JSON object.
 *
 * `schema` is sent as a strict `json_schema` response format so the provider constrains
 * generation, and `provider.require_parameters` keeps OpenRouter from routing to a provider that
 * would silently ignore it and hand back prose.
 */
export async function callStageJson(
  systemPrompt: string,
  userPrompt: string,
  schema: Record<string, unknown>,
  schemaName: string,
  ctx: StageContext,
): Promise<StageCallResult> {
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const outcome = await withLlmRetry(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const body: Record<string, unknown> = {
          model: ctx.model,
          // Cap the output budget so the router reserves a realistic amount of credit rather than
          // the model's full capacity. See DEFAULT_MAX_TOKENS.
          max_tokens: ctx.maxTokens ?? DEFAULT_MAX_TOKENS,
          // No `temperature`. Reasoning endpoints (the gpt-5.x family this pipeline defaults to)
          // do not advertise it, and `require_parameters` below is all-or-nothing: asking for a
          // parameter no endpoint declares leaves OpenRouter with nothing to route to, and the
          // whole call fails with a bare 404 ("No endpoints found that can handle the requested
          // parameters"). Nothing is lost — the routed provider ignored `temperature: 0` anyway.
          // Without this, OpenRouter may route to a provider that silently ignores
          // response_format and hands back prose, which surfaces as an unreproducible
          // "invalid JSON" failure.
          provider: { require_parameters: true },
          response_format: {
            type: "json_schema",
            json_schema: { name: schemaName, strict: true, schema },
          },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        };
        if (ctx.effort) body.reasoning = { effort: ctx.effort };
        if (ctx.fallbackModels?.length) body.models = [ctx.model, ...ctx.fallbackModels];

        const response = await ctx.fetchFn("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const message = `OpenRouter request failed: ${response.status}`;
          if (isRetryableStatus(response.status)) {
            throw new RetryableLlmError(
              message,
              parseRetryAfterMs(response.headers.get("retry-after"), Date.now()),
            );
          }
          throw new Error(message);
        }

        const payload = asObject(await response.json());
        const firstChoice = asObject(asArray(payload.choices)[0]);
        const finishReasonRaw = firstChoice.finish_reason;
        const finishReason = typeof finishReasonRaw === "string" ? finishReasonRaw : null;

        // A truncated answer is not a malformed one. Naming it separately means a retry is
        // meaningful rather than a repeat of the same request.
        if (finishReason === "length") {
          throw new RetryableLlmError(TRUNCATED_ERROR_MESSAGE);
        }

        const contentText = extractContentText(asObject(firstChoice.message));
        const usageRaw = asObject(payload.usage);

        return {
          parsed: parseJsonObject(contentText),
          usage: {
            promptTokens: asNumberOrNull(usageRaw.prompt_tokens),
            completionTokens: asNumberOrNull(usageRaw.completion_tokens),
          },
          finishReason,
        };
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          throw new RetryableLlmError("OpenRouter request timed out");
        }
        // A network-level fetch failure has no status; treat it as transient.
        if (error instanceof TypeError) {
          throw new RetryableLlmError(`OpenRouter request failed: ${error.message}`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    {
      maxAttempts: ctx.maxAttempts,
      sleepFn: ctx.sleepFn,
      jitterFn: ctx.jitterFn,
      log: ctx.log,
    },
  );

  return { ...outcome.value, attempts: outcome.attempts };
}
