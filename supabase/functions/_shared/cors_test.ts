import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "./cors.ts";

Deno.test("corsHeaders include required defaults", () => {
  assertEquals(corsHeaders["Access-Control-Allow-Origin"], "*");
  assertEquals(
    corsHeaders["Access-Control-Allow-Headers"],
    "authorization, x-client-info, apikey, content-type, traceparent, x-request-id",
  );
  assertEquals(corsHeaders["Access-Control-Allow-Methods"], "POST, OPTIONS");
});
