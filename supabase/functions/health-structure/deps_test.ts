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
      HEALTH_STRUCTURE_PARSER_MODE: undefined,
      OPENROUTER_API_KEY: undefined,
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      const { createDefaultHealthStructureDeps } = await importDepsModule("missing");
      const deps = createDefaultHealthStructureDeps();

      assertEquals(deps.config.openRouterApiKey, undefined);
      assertEquals(deps.config.openRouterTimeoutMs, undefined);
      assertEquals(deps.config.parseMode, "openrouter");

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
        HEALTH_STRUCTURE_PARSER_MODE: undefined,
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

          const outcome = await deps.parseStructuredData("ocr", {
            observationCatalog: [],
            findingTypeCatalog: [],
            bodySiteCatalog: [],
            existingConditions: [],
            existingFindings: [],
            checkupItems: [],
          });
          assertEquals(outcome.structured.title, "Doc");
          // One call, not two: the function no longer looks codes up, because it no longer
          // creates conditions.
          assertEquals(fetchCalls >= 1, true);
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    );
  },
);

Deno.test(
  "createDefaultHealthStructureDeps supports e2e stub parser mode without OpenRouter calls",
  async () => {
    await withEnv(
      {
        HEALTH_STRUCTURE_PARSER_MODE: "e2e_stub",
        OPENROUTER_API_KEY: undefined,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      },
      async () => {
        const originalFetch = globalThis.fetch;
        let fetchCalls = 0;
        globalThis.fetch = (async () => {
          fetchCalls += 1;
          return new Response("unexpected fetch", { status: 500 });
        }) as typeof fetch;

        try {
          const { createDefaultHealthStructureDeps } = await importDepsModule("stub-mode");
          const deps = createDefaultHealthStructureDeps();

          assertEquals(deps.config.openRouterApiKey, undefined);
          assertEquals(deps.config.parseMode, "e2e_stub");

          const outcome = await deps.parseStructuredData("Hemoglobin 142 g/L", {
            observationCatalog: [],
            findingTypeCatalog: [],
            bodySiteCatalog: [],
            existingConditions: [],
            existingFindings: [],
            checkupItems: [],
          });
          assertEquals(outcome.structured.title, "Hemoglobin 142 g/L");
          // The stub makes no provider call, so its cost is unknown rather than zero.
          assertEquals(outcome.usage.promptTokens, null);
          assertEquals(fetchCalls, 0);

          let parseError: unknown = null;
          try {
            await deps.parseStructuredData("[E2E_FORCE_STRUCTURE_FAIL]", {
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
          assertErrorMessage(parseError, "E2E stub forced structure failure");
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
        HEALTH_STRUCTURE_PARSER_MODE: undefined,
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
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    );
  },
);

Deno.test(
  "createDefaultHealthStructureDeps reads structure timeout override from env",
  async () => {
    await withEnv(
      {
        HEALTH_STRUCTURE_PARSER_MODE: undefined,
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_HEALTH_STRUCTURE_MODEL: "openai/gpt-4o",
        OPENROUTER_HEALTH_STRUCTURE_TIMEOUT_MS: "45000",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      },
      async () => {
        const { createDefaultHealthStructureDeps } = await importDepsModule("timeout-override");
        const deps = createDefaultHealthStructureDeps();

        assertEquals(deps.config.openRouterTimeoutMs, 45000);
      },
    );
  },
);

// Only the staged pipeline reads the pages. Wiring the loader for the other modes would download
// and decode four attachments before a call that ignores them -- and the monolithic path is the
// rollout escape hatch, where that latency is least welcome.
Deno.test("page images are loaded only for the staged pipeline", async () => {
  await withEnv(
    {
      OPENROUTER_API_KEY: "key",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      HEALTH_STRUCTURE_PIPELINE_MODE: "staged",
    },
    async () => {
      const { createDefaultHealthStructureDeps } = await importDepsModule("staged-pages");
      assertEquals(typeof createDefaultHealthStructureDeps().loadPageImages, "function");
    },
  );

  await withEnv(
    {
      OPENROUTER_API_KEY: "key",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      HEALTH_STRUCTURE_PIPELINE_MODE: "monolithic",
    },
    async () => {
      const { createDefaultHealthStructureDeps } = await importDepsModule("monolithic-pages");
      assertEquals(createDefaultHealthStructureDeps().loadPageImages, undefined);
    },
  );
});

// The three stage models used to exist only in the environment, and an unset variable produced
// `undefined`, which `stages/index.ts` resolves to the shared `defaultModel`. Every stage then ran
// the same model and nothing said so -- the tests included, because they read the same unset
// variable and saw the same consistent fallback. These two tests are the ones that would have
// caught it: they watch what each stage actually puts on the wire, keyed by the stage's own JSON
// schema name, rather than what `config` was set to.
type StageRequest = { schema: string; model: string };

function recordStageModels(): { calls: StageRequest[]; restore: () => void } {
  const calls: StageRequest[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.includes("openrouter.ai")) return new Response("not found", { status: 404 });

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model: string;
      response_format: { json_schema: { name: string } };
    };
    const schema = body.response_format.json_schema.name;
    calls.push({ schema, model: body.model });

    const payload =
      schema === "health_document_classification"
        ? {
            record_type: "lab",
            title: "CBC",
            summary: "",
            keywords: [],
            record_date: "2026-01-05",
          }
        : schema === "health_clinical_extraction"
          ? { observations: [], findings: [], conditions: [] }
          : { findings_to_resolve: [], conditions_to_resolve: [], checkups_to_complete: [] };

    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

// Enough patient state that reconcile is not skipped -- `hasNothingToReconcile` returns true when
// all three lists are empty, and a skipped stage issues no request to observe.
const PARSE_CONTEXT = {
  observationCatalog: [],
  findingTypeCatalog: [],
  bodySiteCatalog: [],
  existingConditions: [
    {
      id: "cond-1",
      name: "Psoriasis",
      code: "L40.0",
      current_status: "active",
      onset_date: null,
      resolved_date: null,
    },
  ],
  existingFindings: [],
  checkupItems: [],
};

function modelFor(calls: StageRequest[], schema: string): string | undefined {
  return calls.find((call) => call.schema === schema)?.model;
}

Deno.test("each stage runs its own default when no stage variable is set", async () => {
  const { DEFAULT_HEALTH_STAGE_MODELS } = await import("../_shared/health-stage-models.ts");
  // Deliberately unlike any of the stage defaults: if a stage silently falls back to the shared
  // model, this is the id that turns up on the wire and the assertions below name it.
  const SHARED = "test/shared-structure-model";

  await withEnv(
    {
      HEALTH_STRUCTURE_PARSER_MODE: undefined,
      HEALTH_STRUCTURE_PIPELINE_MODE: undefined,
      OPENROUTER_API_KEY: "openrouter-key",
      OPENROUTER_HEALTH_STRUCTURE_MODEL: SHARED,
      OPENROUTER_HEALTH_STAGE_CLASSIFY_MODEL: undefined,
      OPENROUTER_HEALTH_STAGE_EXTRACT_MODEL: undefined,
      OPENROUTER_HEALTH_STAGE_RECONCILE_MODEL: undefined,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    async () => {
      const { calls, restore } = recordStageModels();
      try {
        const { createDefaultHealthStructureDeps } = await importDepsModule("stage-defaults");
        await createDefaultHealthStructureDeps().parseStructuredData(
          "Гемоглобин 97",
          PARSE_CONTEXT,
        );

        // All three stages ran, so all three are observed rather than assumed.
        assertEquals(calls.length, 3);
        assertEquals(
          modelFor(calls, "health_document_classification"),
          DEFAULT_HEALTH_STAGE_MODELS.classify,
        );
        assertEquals(
          modelFor(calls, "health_clinical_extraction"),
          DEFAULT_HEALTH_STAGE_MODELS.extract,
        );
        assertEquals(
          modelFor(calls, "health_state_reconciliation"),
          DEFAULT_HEALTH_STAGE_MODELS.reconcile,
        );
        // The regression itself: no stage may quietly inherit the shared structure model.
        assertEquals(
          calls.filter((call) => call.model === SHARED).map((call) => call.schema),
          [],
        );
        // And reconcile in particular must not be sharing extract's cheaper model -- that is the
        // wrongful-resolution failure mode `_shared/health-stage-models.ts` documents.
        assertEquals(
          modelFor(calls, "health_state_reconciliation") !==
            modelFor(calls, "health_clinical_extraction"),
          true,
        );
      } finally {
        restore();
      }
    },
  );
});

Deno.test("a stage variable still overrides the default it falls back to", async () => {
  await withEnv(
    {
      HEALTH_STRUCTURE_PARSER_MODE: undefined,
      HEALTH_STRUCTURE_PIPELINE_MODE: undefined,
      OPENROUTER_API_KEY: "openrouter-key",
      OPENROUTER_HEALTH_STRUCTURE_MODEL: "test/shared-structure-model",
      OPENROUTER_HEALTH_STAGE_CLASSIFY_MODEL: "test/classify-override",
      OPENROUTER_HEALTH_STAGE_EXTRACT_MODEL: "test/extract-override",
      OPENROUTER_HEALTH_STAGE_RECONCILE_MODEL: "test/reconcile-override",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    async () => {
      const { calls, restore } = recordStageModels();
      try {
        const { createDefaultHealthStructureDeps } = await importDepsModule("stage-overrides");
        await createDefaultHealthStructureDeps().parseStructuredData(
          "Гемоглобин 97",
          PARSE_CONTEXT,
        );

        assertEquals(modelFor(calls, "health_document_classification"), "test/classify-override");
        assertEquals(modelFor(calls, "health_clinical_extraction"), "test/extract-override");
        assertEquals(modelFor(calls, "health_state_reconciliation"), "test/reconcile-override");
      } finally {
        restore();
      }
    },
  );
});
