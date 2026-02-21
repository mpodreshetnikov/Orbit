import { assertEquals } from "std/assert/assert-equals";
import { corsHeaders } from "./cors.ts";

Deno.test("corsHeaders include required defaults", () => {
  assertEquals(corsHeaders["Access-Control-Allow-Origin"], "*");
  assertEquals(
    corsHeaders["Access-Control-Allow-Headers"],
    "authorization, x-client-info, apikey, content-type",
  );
});
