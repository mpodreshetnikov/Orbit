import { assertEquals } from "std/assert/assert-equals";
import { selectSuggestedTitle } from "./title.ts";

Deno.test("selectSuggestedTitle returns trimmed title when present", () => {
  assertEquals(selectSuggestedTitle("  Lab Results  ", "Fallback"), "Lab Results");
});

Deno.test("selectSuggestedTitle falls back for empty or invalid title", () => {
  assertEquals(selectSuggestedTitle("   ", "Fallback"), "Fallback");
  assertEquals(selectSuggestedTitle(null, "Fallback"), "Fallback");
});
