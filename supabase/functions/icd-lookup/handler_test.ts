// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "../_shared/cors.ts";
import { withEnv } from "../_shared/testing/env.ts";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { createIcdLookupHandler } from "./handler.ts";
import type { WhoIcdClient } from "./who-client.ts";

function assertIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`Expected "${actual}" to include "${expected}"`);
  }
}

function createWhoClient(overrides: Partial<WhoIcdClient> = {}): WhoIcdClient {
  return {
    getAccessToken: async () => "token",
    lookupIcdCode: async () => "Name",
    searchIcdCodes: async () => [],
    ...overrides,
  };
}

Deno.test("icd-lookup handler responds to OPTIONS", async () => {
  const handler = createIcdLookupHandler({ whoClient: createWhoClient() });
  const response = await handler(
    new Request("http://localhost/functions/v1/icd-lookup", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    corsHeaders["Access-Control-Allow-Origin"],
  );
});

Deno.test("icd-lookup handler validates required code field", async () => {
  const handler = createIcdLookupHandler({ whoClient: createWhoClient() });
  const payload = await assertJsonResponse<{ error: string; found: boolean }>(
    await handler(
      new Request("http://localhost/functions/v1/icd-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    ),
    400,
  );

  assertEquals(payload.found, false);
  assertIncludes(payload.error, "Missing code parameter");
});

Deno.test("icd-lookup handler returns lookup payload for code requests", async () => {
  const handler = createIcdLookupHandler({
    whoClient: createWhoClient({
      lookupIcdCode: async () => "Iron deficiency anemia",
    }),
  });

  const payload = await assertJsonResponse<{
    code: string;
    name_en: string | null;
    found: boolean;
  }>(
    await handler(
      new Request("http://localhost/functions/v1/icd-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "D50.9" }),
      }),
    ),
    200,
  );

  assertEquals(payload.code, "D50.9");
  assertEquals(payload.name_en, "Iron deficiency anemia");
  assertEquals(payload.found, true);
});

Deno.test("icd-lookup handler returns search results", async () => {
  const handler = createIcdLookupHandler({
    whoClient: createWhoClient({
      searchIcdCodes: async () => [{ code: "D50.9", name: "Iron deficiency anemia" }],
    }),
  });

  const payload = await assertJsonResponse<{ results: Array<{ code: string; name: string }> }>(
    await handler(
      new Request("http://localhost/functions/v1/icd-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search: "anemia" }),
      }),
    ),
    200,
  );

  assertEquals(payload.results, [{ code: "D50.9", name: "Iron deficiency anemia" }]);
});

Deno.test("icd-lookup default handler reports missing WHO credentials", async () => {
  await withEnv(
    {
      WHO_ICD_CLIENT_ID: undefined,
      WHO_ICD_CLIENT_SECRET: undefined,
    },
    async () => {
      const { handleRequest } = await import(`./handler.ts?missing-creds=${Date.now()}`);
      const response = await handleRequest(
        new Request("http://localhost/functions/v1/icd-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "D50.9" }),
        }),
      );

      const payload = await assertJsonResponse<{ error: string; found: boolean }>(response, 400);
      assertEquals(payload.found, false);
      assertIncludes(payload.error, "WHO ICD API credentials not configured");
    },
  );
});
