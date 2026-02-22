// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { runIcdLookupService } from "./service.ts";
import type { WhoIcdClient } from "./who-client.ts";

function createWhoClient(overrides: Partial<WhoIcdClient> = {}): WhoIcdClient {
  return {
    getAccessToken: async () => "token",
    lookupIcdCode: async () => "Name",
    searchIcdCodes: async () => [],
    ...overrides,
  };
}

Deno.test("runIcdLookupService returns validation error when code is missing", async () => {
  const whoClient = createWhoClient();
  const result = await runIcdLookupService({}, { whoClient });
  assertEquals(result.status, 400);
  assertEquals(result.payload.found, false);
  assertEquals(result.payload.error, "Missing code parameter");
});

Deno.test("runIcdLookupService handles search requests with explicit maxResults", async () => {
  let calledWith: { query: string; maxResults: number | undefined } | null = null;
  const whoClient = createWhoClient({
    searchIcdCodes: async (query, maxResults) => {
      calledWith = { query, maxResults };
      return [{ code: "D50.9", name: "Iron deficiency anemia" }];
    },
  });

  const result = await runIcdLookupService({ search: "anemia", maxResults: 5 }, { whoClient });

  assertEquals(result.status, 200);
  assertEquals(calledWith, { query: "anemia", maxResults: 5 });
  assertEquals(result.payload.results, [{ code: "D50.9", name: "Iron deficiency anemia" }]);
});

Deno.test("runIcdLookupService returns found=false when lookup yields no match", async () => {
  const whoClient = createWhoClient({
    lookupIcdCode: async () => null,
  });

  const result = await runIcdLookupService({ code: "ZZZ" }, { whoClient });
  assertEquals(result.status, 200);
  assertEquals(result.payload.code, "ZZZ");
  assertEquals(result.payload.name_en, null);
  assertEquals(result.payload.found, false);
});
