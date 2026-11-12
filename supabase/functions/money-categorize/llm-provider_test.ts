import { assertEquals } from "std/assert/assert-equals";
import {
  isMoneyLlmProviderConfigured,
  moneyLlmProviderStatus,
  resolveMoneyLlmProvider,
} from "./llm-provider.ts";

Deno.test("resolveMoneyLlmProvider defaults to jev", () => {
  assertEquals(resolveMoneyLlmProvider({}), "jev");
  assertEquals(resolveMoneyLlmProvider({ provider: "jev" }), "jev");
  assertEquals(resolveMoneyLlmProvider({ provider: "openrouter" }), "openrouter");
  assertEquals(resolveMoneyLlmProvider({ provider: "other" }), "jev");
});

Deno.test("isMoneyLlmProviderConfigured checks the selected key only", () => {
  assertEquals(
    isMoneyLlmProviderConfigured("jev", { jevApiKey: "k", openRouterApiKey: null }),
    true,
  );
  assertEquals(
    isMoneyLlmProviderConfigured("openrouter", { jevApiKey: "k", openRouterApiKey: null }),
    false,
  );
  assertEquals(
    isMoneyLlmProviderConfigured("openrouter", { jevApiKey: null, openRouterApiKey: "k" }),
    true,
  );
});

Deno.test("moneyLlmProviderStatus reports both providers without leaking keys", () => {
  assertEquals(moneyLlmProviderStatus({ jevApiKey: "secret", openRouterApiKey: "" }), {
    jev: { configured: true },
    openrouter: { configured: false },
    default_provider: "jev",
  });
});
