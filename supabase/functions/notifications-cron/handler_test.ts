import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "../_shared/cors.ts";

function assertIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`Expected "${actual}" to include "${expected}"`);
  }
}

Deno.test("notifications-cron handler responds to OPTIONS", async () => {
  const { handleRequest } = await import(`./handler.ts?opts=${Date.now()}`);
  const response = await handleRequest(
    new Request("http://localhost/functions/v1/notifications-cron", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), corsHeaders["Access-Control-Allow-Origin"]);
});

Deno.test("notifications-cron handler fails when Supabase env is missing", async () => {
  const prevUrl = Deno.env.get("SUPABASE_URL");
  const prevServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");

  try {
    const { handleRequest } = await import(`./handler.ts?missing-env=${Date.now()}`);
    const response = await handleRequest(
      new Request("http://localhost/functions/v1/notifications-cron", { method: "POST" }),
    );
    assertEquals(response.status, 500);
    const payload = (await response.json()) as { error: string };
    assertIncludes(payload.error, "Server configuration error");
  } finally {
    if (prevUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", prevUrl);
    if (prevServiceKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prevServiceKey);
  }
});

