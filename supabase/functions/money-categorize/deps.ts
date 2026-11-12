import { callJevMoneyCategorizeBatch, DEFAULT_JEV_MODEL } from "./jev-categorize.ts";
import {
  moneyLlmProviderStatus,
  resolveMoneyLlmProvider,
  type MoneyLlmProvider,
} from "./llm-provider.ts";
import { callOpenRouterMoneyCategorizeBatch } from "./openrouter-categorize.ts";
import { createSupabaseMoneyCategorizeRepository } from "./repository.ts";
import type { MoneyCategorizeServiceDeps } from "./service.ts";

/** Independent of OpenRouter timeout; sized under the web client's ~20s wall budget. */
const DEFAULT_JEV_TIMEOUT_MS = 12_000;

export function createDefaultMoneyCategorizeDeps(): MoneyCategorizeServiceDeps & {
  authenticateAllowedUser(token: string): Promise<{ userId: string; email: string | null } | null>;
  getLlmProviderStatus(): ReturnType<typeof moneyLlmProviderStatus>;
} {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  const openRouterModel =
    Deno.env.get("OPENROUTER_MONEY_CATEGORIZE_MODEL") ?? "google/gemini-2.0-flash-001";
  const batchSizeRaw = Deno.env.get("OPENROUTER_MONEY_CATEGORIZE_BATCH_SIZE");
  const openRouterBatchSize =
    batchSizeRaw && Number.isFinite(Number(batchSizeRaw)) && Number(batchSizeRaw) > 0
      ? Math.floor(Number(batchSizeRaw))
      : 4;
  const timeoutRaw = Deno.env.get("OPENROUTER_MONEY_CATEGORIZE_TIMEOUT_MS");
  const timeoutMs =
    timeoutRaw && Number.isFinite(Number(timeoutRaw)) ? Number(timeoutRaw) : undefined;

  const jevApiKey = Deno.env.get("JEV_API_KEY") ?? Deno.env.get("TYPESAFE_API_KEY");
  const jevModel = Deno.env.get("JEV_MONEY_CATEGORIZE_MODEL") ?? DEFAULT_JEV_MODEL;
  const jevBaseUrl = Deno.env.get("TYPESAFE_BASE_URL") ?? undefined;
  const jevConcurrencyRaw = Deno.env.get("JEV_MONEY_CATEGORIZE_CONCURRENCY");
  const jevConcurrency =
    jevConcurrencyRaw && Number.isFinite(Number(jevConcurrencyRaw)) && Number(jevConcurrencyRaw) > 0
      ? Math.floor(Number(jevConcurrencyRaw))
      : 4;
  const jevTimeoutRaw = Deno.env.get("JEV_MONEY_CATEGORIZE_TIMEOUT_MS");
  const jevTimeoutMs =
    jevTimeoutRaw && Number.isFinite(Number(jevTimeoutRaw)) && Number(jevTimeoutRaw) > 0
      ? Number(jevTimeoutRaw)
      : DEFAULT_JEV_TIMEOUT_MS;

  const repository = createSupabaseMoneyCategorizeRepository({
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? undefined,
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? undefined,
    supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? undefined,
  });

  const providerEnv = { jevApiKey, openRouterApiKey };

  return {
    repository,
    llmBatchSize: openRouterBatchSize,
    authenticateAllowedUser: repository.authenticateAllowedUser,
    getLlmProviderStatus: () => moneyLlmProviderStatus(providerEnv),
    categorizeWithLlmBatch: async (request) => {
      const provider: MoneyLlmProvider = resolveMoneyLlmProvider(request.rule.config);

      if (provider === "jev") {
        if (!jevApiKey) {
          throw new Error("JEV_API_KEY is required");
        }
        return await callJevMoneyCategorizeBatch(request, {
          fetchFn: globalThis.fetch,
          apiKey: jevApiKey,
          model: jevModel,
          baseUrl: jevBaseUrl,
          timeoutMs: jevTimeoutMs,
          concurrency: jevConcurrency,
        });
      }

      if (!openRouterApiKey) {
        throw new Error("OPENROUTER_API_KEY is required");
      }
      return await callOpenRouterMoneyCategorizeBatch(request, {
        fetchFn: globalThis.fetch,
        apiKey: openRouterApiKey,
        model: openRouterModel,
        timeoutMs,
      });
    },
  };
}
