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

const DEFAULT_TIMEOUT_MS = 60_000;

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
          temperature: 0,
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
