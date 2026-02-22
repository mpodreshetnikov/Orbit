import { assertEquals } from "std/assert/assert-equals";
import { withEnv } from "../_shared/testing/env.ts";

async function importDepsModule(suffix: string) {
  return await import(`./deps.ts?deps-test=${suffix}-${Date.now()}`);
}

Deno.test("createDefaultHealthOcrDeps reflects missing env configuration", async () => {
  await withEnv(
    {
      OPENROUTER_API_KEY: undefined,
      SUPABASE_URL: undefined,
      SUPABASE_ANON_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      const { createDefaultHealthOcrDeps } = await importDepsModule("missing");
      const deps = createDefaultHealthOcrDeps();
      assertEquals(deps.config.openRouterApiKey, undefined);
      assertEquals(deps.openRouterClient, null);

      let caught: unknown = null;
      try {
        deps.createRepository("token");
      } catch (error) {
        caught = error;
      }
      assertEquals((caught as Error).message, "Supabase environment not configured");
    },
  );
});

Deno.test(
  "createDefaultHealthOcrDeps creates repository and OpenRouter client when env is set",
  async () => {
    await withEnv(
      {
        OPENROUTER_API_KEY: "openrouter-key",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      },
      async () => {
        const { createDefaultHealthOcrDeps } = await importDepsModule("present");
        const deps = createDefaultHealthOcrDeps();

        assertEquals(deps.config.openRouterApiKey, "openrouter-key");
        assertEquals(deps.config.supabaseUrl, "https://example.supabase.co");
        assertEquals(deps.openRouterClient !== null, true);

        const repository = deps.createRepository("token");
        assertEquals(typeof repository.authenticateUser, "function");
        assertEquals(typeof repository.updateRecordSuccess, "function");
      },
    );
  },
);
