import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "../_shared/cors.ts";

function assertIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`Expected "${actual}" to include "${expected}"`);
  }
}

Deno.test("money-import handler responds to OPTIONS", async () => {
  const { handleRequest } = await import(`./handler.ts?opts=${Date.now()}`);
  const response = await handleRequest(
    new Request("http://localhost/functions/v1/money-import", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), corsHeaders["Access-Control-Allow-Origin"]);
});

Deno.test("money-import handler rejects non-POST methods", async () => {
  const { handleRequest } = await import(`./handler.ts?method=${Date.now()}`);
  const response = await handleRequest(
    new Request("http://localhost/functions/v1/money-import", { method: "GET" }),
  );
  assertEquals(response.status, 405);
  const payload = (await response.json()) as { error: string };
  assertIncludes(payload.error, "Method not allowed");
});

Deno.test("money-import handler reports missing Supabase env", async () => {
  const prevUrl = Deno.env.get("SUPABASE_URL");
  const prevServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");

  try {
    const { handleRequest } = await import(`./handler.ts?missing-env=${Date.now()}`);
    const response = await handleRequest(
      new Request("http://localhost/functions/v1/money-import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
        body: JSON.stringify({ action: "create_session" }),
      }),
    );
    assertEquals(response.status, 400);
    const payload = (await response.json()) as { error: string };
    assertIncludes(payload.error, "Supabase environment not configured");
  } finally {
    if (prevUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", prevUrl);
    if (prevServiceKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prevServiceKey);
  }
});

