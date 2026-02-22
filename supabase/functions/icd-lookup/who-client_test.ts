import { assertEquals } from "std/assert/assert-equals";
import { createFetchStub, toUrlString } from "../_shared/testing/fetch-stub.ts";
import { createWhoIcdClient } from "./who-client.ts";

async function assertThrowsWithMessage(
  run: () => Promise<unknown>,
  expectedSnippet: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }

  if (!(caught instanceof Error)) {
    throw new Error("Expected an Error to be thrown");
  }
  if (!caught.message.includes(expectedSnippet)) {
    throw new Error(`Expected "${caught.message}" to include "${expectedSnippet}"`);
  }
}

Deno.test("createWhoIcdClient caches token until expiry", async () => {
  const fetchStub = createFetchStub();
  fetchStub.expectJson("token", "https://icdaccessmanagement.who.int/connect/token", {
    access_token: "cached-token",
    expires_in: 120,
  });
  fetchStub.install();

  let nowMs = 1_000;
  try {
    const client = createWhoIcdClient({
      fetchFn: globalThis.fetch,
      clientId: "client",
      clientSecret: "secret",
      now: () => nowMs,
    });

    const first = await client.getAccessToken();
    const second = await client.getAccessToken();
    assertEquals(first, "cached-token");
    assertEquals(second, "cached-token");
    assertEquals(fetchStub.calls().length, 1);

    nowMs += 70_000;
    fetchStub.expectJson("token-refresh", "https://icdaccessmanagement.who.int/connect/token", {
      access_token: "fresh-token",
      expires_in: 120,
    });
    const refreshed = await client.getAccessToken();
    assertEquals(refreshed, "fresh-token");
    assertEquals(fetchStub.calls().length, 2);
    fetchStub.assertDone();
  } finally {
    fetchStub.restore();
  }
});

Deno.test("createWhoIcdClient throws when credentials are missing", async () => {
  const client = createWhoIcdClient({
    fetchFn: globalThis.fetch,
    clientId: undefined,
    clientSecret: undefined,
  });

  await assertThrowsWithMessage(
    () => client.getAccessToken(),
    "WHO ICD API credentials not configured",
  );
});

Deno.test("lookupIcdCode retries with dotted code after 404", async () => {
  const fetchStub = createFetchStub();
  fetchStub.expectJson("token", "https://icdaccessmanagement.who.int/connect/token", {
    access_token: "token",
    expires_in: 120,
  });
  fetchStub.expectText(
    "lookup-normalized",
    "https://id.who.int/icd/release/10/2019/D509",
    "not found",
    { status: 404 },
  );
  fetchStub.expectJson("lookup-dotted", "https://id.who.int/icd/release/10/2019/D50.9", {
    title: { "@value": "Iron deficiency anemia, unspecified" },
  });
  fetchStub.install();

  try {
    const client = createWhoIcdClient({
      fetchFn: globalThis.fetch,
      clientId: "client",
      clientSecret: "secret",
    });

    const result = await client.lookupIcdCode("D50.9", "en");
    assertEquals(result, "Iron deficiency anemia, unspecified");
    fetchStub.assertDone();
  } finally {
    fetchStub.restore();
  }
});

Deno.test("lookupIcdCode returns null on non-404 API error", async () => {
  const fetchStub = createFetchStub();
  fetchStub.expectJson("token", "https://icdaccessmanagement.who.int/connect/token", {
    access_token: "token",
    expires_in: 120,
  });
  fetchStub.expectText(
    "lookup-500",
    "https://id.who.int/icd/release/10/2019/E119",
    "server error",
    { status: 500 },
  );
  fetchStub.install();

  try {
    const client = createWhoIcdClient({
      fetchFn: globalThis.fetch,
      clientId: "client",
      clientSecret: "secret",
    });
    const result = await client.lookupIcdCode("E11.9", "en");
    assertEquals(result, null);
    fetchStub.assertDone();
  } finally {
    fetchStub.restore();
  }
});

Deno.test("searchIcdCodes returns ICD-10 results from WHO entity search", async () => {
  const fetchStub = createFetchStub();
  fetchStub.expectJson("token", "https://icdaccessmanagement.who.int/connect/token", {
    access_token: "token",
    expires_in: 120,
  });
  fetchStub.expectJsonUnordered("entity-search", /https:\/\/id\.who\.int\/icd\/entity\/search\?/, {
    guessType: "term",
    destinationEntities: [
      {
        theCode: "9D00",
        title: { "@value": "Iron deficiency anemia" },
        matchingPVs: [{ propertyId: "Title", label: "Iron deficiency anemia (D50.9)" }],
      },
      {
        theCode: "D50.9",
        title: "Iron deficiency anemia duplicate",
        matchingPVs: [],
      },
    ],
  });
  fetchStub.install();

  try {
    const client = createWhoIcdClient({
      fetchFn: globalThis.fetch,
      clientId: "client",
      clientSecret: "secret",
    });

    const results = await client.searchIcdCodes("iron deficiency", 10);
    assertEquals(results.length, 1);
    assertEquals(results[0], { code: "D50.9", name: "Iron deficiency anemia" });
    fetchStub.assertDone();
  } finally {
    fetchStub.restore();
  }
});

Deno.test("searchIcdCodes uses code lookup strategy for code-like queries", async () => {
  const fetchStub = createFetchStub();
  fetchStub.expectJson("token", "https://icdaccessmanagement.who.int/connect/token", {
    access_token: "token",
    expires_in: 120,
  });
  fetchStub.install();

  try {
    const client = createWhoIcdClient({
      fetchFn: globalThis.fetch,
      clientId: "client",
      clientSecret: "secret",
    });

    await client.getAccessToken(); // prime cache so parallel lookups don't require token fetches

    fetchStub.expectUnordered(
      "code-lookups",
      (input) => /https:\/\/id\.who\.int\/icd\/release\/10\/2019\//.test(toUrlString(input)),
      (input) => {
        const url = toUrlString(input);
        if (url.endsWith("/H523")) {
          return new Response(JSON.stringify({ title: { "@value": "Astigmatism" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/H524")) {
          return new Response(JSON.stringify({ title: { "@value": "Presbyopia" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("error", { status: 500 });
      },
      8,
    );

    const results = await client.searchIcdCodes("H52.3", 2);
    assertEquals(results, [
      { code: "H52.3", name: "Astigmatism" },
      { code: "H52.4", name: "Presbyopia" },
    ]);
    fetchStub.assertDone();
  } finally {
    fetchStub.restore();
  }
});

Deno.test("createWhoIcdClient throws on malformed token payload", async () => {
  const fetchStub = createFetchStub();
  fetchStub.expectJson("token-malformed", "https://icdaccessmanagement.who.int/connect/token", {
    access_token: "",
    expires_in: "bad",
  });
  fetchStub.install();

  try {
    const client = createWhoIcdClient({
      fetchFn: globalThis.fetch,
      clientId: "client",
      clientSecret: "secret",
    });
    await assertThrowsWithMessage(
      () => client.getAccessToken(),
      "WHO ICD token response malformed",
    );
    fetchStub.assertDone();
  } finally {
    fetchStub.restore();
  }
});

Deno.test("searchIcdCodes returns empty results when WHO search fails", async () => {
  const fetchStub = createFetchStub();
  fetchStub.expectJson("token", "https://icdaccessmanagement.who.int/connect/token", {
    access_token: "token",
    expires_in: 120,
  });
  fetchStub.expectTextUnordered(
    "entity-search-error",
    /https:\/\/id\.who\.int\/icd\/entity\/search\?/,
    "bad gateway",
    { status: 502 },
  );
  fetchStub.install();

  try {
    const client = createWhoIcdClient({
      fetchFn: globalThis.fetch,
      clientId: "client",
      clientSecret: "secret",
    });

    const results = await client.searchIcdCodes("anemia", 10);
    assertEquals(results, []);
    fetchStub.assertDone();
  } finally {
    fetchStub.restore();
  }
});
