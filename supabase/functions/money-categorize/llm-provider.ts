export type MoneyLlmProvider = "jev" | "openrouter";

/**
 * Resolve the LLM provider for an existing rule config.
 * Explicit `jev` / `openrouter` win. Missing or unknown → OpenRouter so legacy
 * rules keep the pre-ORB-44 path (M1). New rules default to Jev only in the editor.
 */
export function resolveMoneyLlmProvider(
  config: Record<string, unknown> | null | undefined,
): MoneyLlmProvider {
  const raw = config?.provider;
  if (raw === "jev") return "jev";
  if (raw === "openrouter") return "openrouter";
  return "openrouter";
}

export function isMoneyLlmProviderConfigured(
  provider: MoneyLlmProvider,
  env: {
    jevApiKey?: string | null;
    openRouterApiKey?: string | null;
  },
): boolean {
  if (provider === "openrouter") {
    return Boolean(env.openRouterApiKey && env.openRouterApiKey.trim().length > 0);
  }
  return Boolean(env.jevApiKey && env.jevApiKey.trim().length > 0);
}

export function moneyLlmProviderStatus(env: {
  jevApiKey?: string | null;
  openRouterApiKey?: string | null;
}): {
  jev: { configured: boolean };
  openrouter: { configured: boolean };
  /** Recommended default for *new* LLM rules in the editor (not the legacy fallback). */
  default_provider: MoneyLlmProvider;
} {
  return {
    jev: { configured: isMoneyLlmProviderConfigured("jev", env) },
    openrouter: { configured: isMoneyLlmProviderConfigured("openrouter", env) },
    default_provider: "jev",
  };
}
