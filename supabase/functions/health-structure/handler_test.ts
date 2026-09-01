// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "../_shared/cors.ts";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { createHealthStructureHandler } from "./handler.ts";
import type { HealthStructureRepository } from "./repository.ts";
import { emptyLlmUsage, type LlmUsage } from "../_shared/llm-usage.ts";
import type { StructuredDataWithEntities, StructuredParseOutcome } from "./types.ts";

/** The parse dependency now reports what the call cost alongside the entities it produced. */
function parsed(
  structured: StructuredDataWithEntities,
  usage: LlmUsage = emptyLlmUsage(),
  stagesRun: string[] = [],
): StructuredParseOutcome {
  return { structured, usage, stagesRun };
}

function createRepositoryMock(): HealthStructureRepository {
  return {
    authenticateAllowedUser: async () => ({ id: "user-1", email: "user@example.com" }),
    renewClaim: async () => true,
    replaceRecordExtractionIssues: async () => {},
    getAttachments: async () => [],
    downloadAttachment: async () => null,
    getRecord: async () => ({
      id: "record-1",
      person_id: "person-1",
      ocr_text: "text",
      status: "ocr_review",
    }),
    fetchObservationCatalog: async () => [],
    fetchFindingTypeCatalog: async () => [],
    fetchBodySiteCatalog: async () => [],
    fetchPersonConditions: async () => [],
    fetchPersonActiveFindings: async () => [],
    fetchUpcomingOverdueCheckupItems: async () => [],
    claimRecord: async () => "run-1",
    updateMedicalRecord: async () => {},
    replaceRecordObservations: async () => {},
    replaceRecordFindings: async () => {},
    clearConditionRecords: async () => {},
    findConditionByIcd: async () => null,
    findConditionByName: async () => null,
    createCondition: async () => ({ id: "cond-1" }),
    updateCondition: async () => {},
    insertConditionRecord: async () => {},
    recomputeConditionCurrentStatus: async () => {},
    insertFinding: async () => {},
  };
}

const minimalStructuredData: StructuredDataWithEntities = {
  record_type: "other",
  title: "Doc",
  record_date: null,
  summary: "",
  keywords: [],
  observations: [],
  findings: [],
  conditions: [],
  findings_to_resolve: [],
  conditions_to_resolve: [],
  checkups_to_complete: [],
};

Deno.test("health-structure handler responds to OPTIONS", async () => {
  const handler = createHealthStructureHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role",
    },
    repository: createRepositoryMock(),
    parseStructuredData: async () => parsed(minimalStructuredData),
    lookupIcdCode: async () => null,
  });
  const response = await handler(
    new Request("http://localhost/functions/v1/health-structure", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    corsHeaders["Access-Control-Allow-Origin"],
  );
});

Deno.test("health-structure handler rejects non-POST methods", async () => {
  const handler = createHealthStructureHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role",
    },
    repository: createRepositoryMock(),
    parseStructuredData: async () => parsed(minimalStructuredData),
    lookupIcdCode: async () => null,
  });
  const payload = await assertJsonResponse<{ success: boolean; error: string }>(
    await handler(new Request("http://localhost/functions/v1/health-structure", { method: "GET" })),
    405,
  );
  assertEquals(payload.success, false);
  assertEquals(payload.error, "Method not allowed");
});

Deno.test("health-structure handler validates env configuration", async () => {
  const missingOpenRouter = createHealthStructureHandler({
    config: {
      openRouterApiKey: undefined,
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role",
    },
    repository: createRepositoryMock(),
    parseStructuredData: async () => parsed(minimalStructuredData),
    lookupIcdCode: async () => null,
  });

  const payload1 = await assertJsonResponse<{ success: boolean; error: string }>(
    await missingOpenRouter(
      new Request("http://localhost/functions/v1/health-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_id: "record-1" }),
      }),
    ),
    400,
  );
  assertEquals(payload1.error, "OPENROUTER_API_KEY is required");

  const missingSupabase = createHealthStructureHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: undefined,
      supabaseServiceRoleKey: undefined,
    },
    repository: createRepositoryMock(),
    parseStructuredData: async () => parsed(minimalStructuredData),
    lookupIcdCode: async () => null,
  });

  const payload2 = await assertJsonResponse<{ success: boolean; error: string }>(
    await missingSupabase(
      new Request("http://localhost/functions/v1/health-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_id: "record-1" }),
      }),
    ),
    400,
  );
  assertEquals(payload2.error, "Supabase environment not configured");
});

Deno.test(
  "health-structure handler allows e2e stub parser mode without OpenRouter key",
  async () => {
    const handler = createHealthStructureHandler({
      config: {
        parseMode: "e2e_stub",
        openRouterApiKey: undefined,
        supabaseUrl: "https://example.supabase.co",
        supabaseServiceRoleKey: "service-role",
      },
      repository: createRepositoryMock(),
      parseStructuredData: async () => parsed(minimalStructuredData),
      lookupIcdCode: async () => null,
    });

    const payload = await assertJsonResponse<{ success: boolean; structured_data: unknown }>(
      await handler(
        new Request("http://localhost/functions/v1/health-structure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer token",
          },
          body: JSON.stringify({ record_id: "record-1" }),
        }),
      ),
      200,
    );

    assertEquals(payload.success, true);
  },
);

Deno.test("health-structure handler executes success and auth-failure paths", async () => {
  const handler = createHealthStructureHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role",
    },
    repository: createRepositoryMock(),
    parseStructuredData: async () => parsed(minimalStructuredData),
    lookupIcdCode: async () => null,
  });

  const successPayload = await assertJsonResponse<{ success: boolean; structured_data: unknown }>(
    await handler(
      new Request("http://localhost/functions/v1/health-structure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({ record_id: "record-1" }),
      }),
    ),
    200,
  );
  assertEquals(successPayload.success, true);

  const authFailHandler = createHealthStructureHandler({
    config: {
      openRouterApiKey: "key",
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role",
    },
    repository: {
      ...createRepositoryMock(),
      authenticateAllowedUser: async () => null,
    },
    parseStructuredData: async () => parsed(minimalStructuredData),
    lookupIcdCode: async () => null,
  });

  const failPayload = await assertJsonResponse<{ success: boolean; error: string }>(
    await authFailHandler(
      new Request("http://localhost/functions/v1/health-structure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer bad-token",
        },
        body: JSON.stringify({ record_id: "record-1" }),
      }),
    ),
    400,
  );
  assertEquals(failPayload.success, false);
  assertEquals(failPayload.error, "Unauthorized - invalid token");
});

Deno.test(
  "health-structure handler handles missing auth token and malformed json body",
  async () => {
    const handler = createHealthStructureHandler({
      config: {
        openRouterApiKey: "key",
        supabaseUrl: "https://example.supabase.co",
        supabaseServiceRoleKey: "service-role",
      },
      repository: createRepositoryMock(),
      parseStructuredData: async () => parsed(minimalStructuredData),
      lookupIcdCode: async () => null,
    });

    const missingAuthPayload = await assertJsonResponse<{ success: boolean; error: string }>(
      await handler(
        new Request("http://localhost/functions/v1/health-structure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record_id: "record-1" }),
        }),
      ),
      400,
    );
    assertEquals(missingAuthPayload.error, "Missing authorization header");

    const malformedPayload = await assertJsonResponse<{ success: boolean; error: string }>(
      await handler(
        new Request("http://localhost/functions/v1/health-structure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer token",
          },
          body: "{",
        }),
      ),
      400,
    );
    assertEquals(malformedPayload.success, false);
    assertEquals(typeof malformedPayload.error, "string");
  },
);
