import { callOpenRouterMoneyCategorizeBatch } from "./openrouter-categorize.ts";
import { createSupabaseMoneyCategorizeRepository } from "./repository.ts";
import type { MoneyCategorizeServiceDeps } from "./service.ts";

export function createDefaultMoneyCategorizeDeps(): MoneyCategorizeServiceDeps & {
  authenticateAllowedUser(token: string): Promise<{ userId: string; email: string | null } | null>;
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

  const repository = createSupabaseMoneyCategorizeRepository({
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? undefined,
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? undefined,
    supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? undefined,
  });

  return {
    repository,
    llmBatchSize: openRouterBatchSize,
    authenticateAllowedUser: repository.authenticateAllowedUser,
    categorizeWithLlmBatch: async (request) => {
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
