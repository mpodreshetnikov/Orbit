import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "../_shared/cors.ts";

function assertIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`Expected "${actual}" to include "${expected}"`);
  }
}

Deno.test("icd-lookup handler responds to OPTIONS", async () => {
  const { handleRequest } = await import(`./handler.ts?opts=${Date.now()}`);
  const response = await handleRequest(
    new Request("http://localhost/functions/v1/icd-lookup", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), corsHeaders["Access-Control-Allow-Origin"]);
});

Deno.test("icd-lookup handler validates required code field", async () => {
  const { handleRequest } = await import(`./handler.ts?missing-code=${Date.now()}`);
  const response = await handleRequest(
    new Request("http://localhost/functions/v1/icd-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string; found: boolean };
  assertEquals(payload.found, false);
  assertIncludes(payload.error, "Missing code parameter");
});

Deno.test("icd-lookup handler reports missing WHO credentials", async () => {
  const prevClientId = Deno.env.get("WHO_ICD_CLIENT_ID");
  const prevClientSecret = Deno.env.get("WHO_ICD_CLIENT_SECRET");
  Deno.env.delete("WHO_ICD_CLIENT_ID");
  Deno.env.delete("WHO_ICD_CLIENT_SECRET");

  try {
    const { handleRequest } = await import(`./handler.ts?missing-creds=${Date.now()}`);
    const response = await handleRequest(
      new Request("http://localhost/functions/v1/icd-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "D50.9" }),
      }),
    );
    assertEquals(response.status, 400);
    const payload = (await response.json()) as { error: string; found: boolean };
    assertEquals(payload.found, false);
    assertIncludes(payload.error, "WHO ICD API credentials not configured");
  } finally {
    if (prevClientId === undefined) Deno.env.delete("WHO_ICD_CLIENT_ID");
    else Deno.env.set("WHO_ICD_CLIENT_ID", prevClientId);
    if (prevClientSecret === undefined) Deno.env.delete("WHO_ICD_CLIENT_SECRET");
    else Deno.env.set("WHO_ICD_CLIENT_SECRET", prevClientSecret);
  }
});

