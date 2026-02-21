import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "../_shared/cors.ts";

function assertIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`Expected "${actual}" to include "${expected}"`);
  }
}

Deno.test("health-structure handler responds to OPTIONS", async () => {
  const { handleRequest } = await import(`./handler.ts?opts=${Date.now()}`);
  const response = await handleRequest(
    new Request("http://localhost/functions/v1/health-structure", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), corsHeaders["Access-Control-Allow-Origin"]);
});

Deno.test("health-structure handler fails fast when OPENROUTER key is missing", async () => {
  const prevOpenRouter = Deno.env.get("OPENROUTER_API_KEY");
  const prevUrl = Deno.env.get("SUPABASE_URL");
  const prevServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  Deno.env.delete("OPENROUTER_API_KEY");
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");

  try {
    const { handleRequest } = await import(`./handler.ts?missing-openrouter=${Date.now()}`);
    const response = await handleRequest(
      new Request("http://localhost/functions/v1/health-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_id: "rec-1" }),
      }),
    );
    assertEquals(response.status, 400);
    const payload = (await response.json()) as { success: boolean; error: string };
    assertEquals(payload.success, false);
    assertIncludes(payload.error, "OPENROUTER_API_KEY");
  } finally {
    if (prevOpenRouter === undefined) Deno.env.delete("OPENROUTER_API_KEY");
    else Deno.env.set("OPENROUTER_API_KEY", prevOpenRouter);
    if (prevUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", prevUrl);
    if (prevServiceKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prevServiceKey);
  }
});

