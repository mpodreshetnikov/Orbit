// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { withEnv } from "../_shared/testing/env.ts";

async function importDepsModule(suffix: string) {
  return await import(`./deps.ts?deps-test=${suffix}-${Date.now()}`);
}

function assertErrorMessage(error: unknown, expected: string): void {
  if (!(error instanceof Error)) throw new Error("Expected Error");
  assertEquals(error.message, expected);
}

Deno.test("createDefaultHealthStructureDeps handles missing env values", async () => {
  await withEnv(
    {
      OPENROUTER_API_KEY: undefined,
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      const { createDefaultHealthStructureDeps } = await importDepsModule("missing");
      const deps = createDefaultHealthStructureDeps();

      assertEquals(deps.config.openRouterApiKey, undefined);
      assertEquals(await deps.lookupIcdCode("A00"), null);

      let parseError: unknown = null;
      try {
        await deps.parseStructuredData("ocr", {
          observationCatalog: [],
          findingTypeCatalog: [],
          bodySiteCatalog: [],
          existingConditions: [],
          existingFindings: [],
          checkupItems: [],
        });
      } catch (error) {
        parseError = error;
      }
      assertErrorMessage(parseError, "OPENROUTER_API_KEY is required");

      let repoError: unknown = null;
      try {
        await deps.repository.getRecord("record-1");
      } catch (error) {
        repoError = error;
      }
      assertErrorMessage(repoError, "Supabase environment not configured");
    },
  );
});

Deno.test(
  "createDefaultHealthStructureDeps performs parse and ICD lookup when env is set",
  async () => {
    await withEnv(
      {
        OPENROUTER_API_KEY: "openrouter-key",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      },
      async () => {
        const originalFetch = globalThis.fetch;
        let fetchCalls = 0;
        globalThis.fetch = (async (input) => {
          fetchCalls += 1;
          const url = typeof input === "string" ? input : input.toString();

          if (url.includes("openrouter.ai")) {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content:
                        '{"record_type":"other","title":"Doc","summary":"","keywords":[],"record_date":null,"observations":[],"findings":[],"conditions":[],"findings_to_resolve":[],"conditions_to_resolve":[],"checkups_to_complete":[]}',
                    },
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          if (url.includes("/functions/v1/icd-lookup")) {
            return new Response(
              JSON.stringify({
                code: "A00",
                name_en: "Cholera",
                name_ru: "Холера",
                found: true,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          return new Response("not found", { status: 404 });
        }) as typeof fetch;

        try {
          const { createDefaultHealthStructureDeps } = await importDepsModule("present");
          const deps = createDefaultHealthStructureDeps();

          const structured = await deps.parseStructuredData("ocr", {
            observationCatalog: [],
            findingTypeCatalog: [],
            bodySiteCatalog: [],
            existingConditions: [],
            existingFindings: [],
            checkupItems: [],
          });
          assertEquals(structured.title, "Doc");

          const icd = await deps.lookupIcdCode("A00");
          assertEquals(icd?.found, true);
          assertEquals(fetchCalls >= 2, true);
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    );
  },
);

Deno.test(
  "createDefaultHealthStructureDeps handles ICD lookup non-OK and fetch failures",
  async () => {
    await withEnv(
      {
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_HEALTH_STRUCTURE_MODEL: "openai/gpt-4o",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      },
      async () => {
        const originalFetch = globalThis.fetch;
        let callIndex = 0;
        globalThis.fetch = (async (input) => {
          callIndex += 1;
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("openrouter.ai")) {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content:
                        '{"record_type":"other","title":"Doc","summary":"","keywords":[],"record_date":null,"observations":[],"findings":[],"conditions":[],"findings_to_resolve":[],"conditions_to_resolve":[],"checkups_to_complete":[]}',
                    },
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          if (callIndex === 2) {
            return new Response("upstream bad gateway", { status: 502 });
          }

          throw new Error("network failed");
        }) as typeof fetch;

        try {
          const { createDefaultHealthStructureDeps } = await importDepsModule("lookup-failures");
          const deps = createDefaultHealthStructureDeps();

          await deps.parseStructuredData("ocr", {
            observationCatalog: [],
            findingTypeCatalog: [],
            bodySiteCatalog: [],
            existingConditions: [],
            existingFindings: [],
            checkupItems: [],
          });

          assertEquals(await deps.lookupIcdCode("A00"), null);
          assertEquals(await deps.lookupIcdCode("A01"), null);
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    );
  },
);
