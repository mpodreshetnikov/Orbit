import { assertEquals } from "std/assert/assert-equals";
import { emptyLlmUsage, parseLlmUsage, sumLlmUsage, usageAttrs } from "./llm-usage.ts";

Deno.test("parseLlmUsage reads the provider's usage object and nothing else", () => {
  const usage = parseLlmUsage({
    choices: [],
    usage: { prompt_tokens: 120, completion_tokens: 18, cost: 0.002 },
  });
  assertEquals(usage, { promptTokens: 120, completionTokens: 18, costUsd: 0.002 });
});

Deno.test("parseLlmUsage reports a missing or malformed usage object as unknown", () => {
  assertEquals(parseLlmUsage({}), emptyLlmUsage());
  assertEquals(parseLlmUsage({ usage: { prompt_tokens: "many" } }), emptyLlmUsage());
});

Deno.test("sumLlmUsage totals the calls it is given", () => {
  const total = sumLlmUsage([
    { promptTokens: 10, completionTokens: 5, costUsd: 0.001 },
    { promptTokens: 20, completionTokens: 10, costUsd: 0.002 },
  ]);
  assertEquals(total, { promptTokens: 30, completionTokens: 15, costUsd: 0.003 });
});

Deno.test("sumLlmUsage makes a component unknown when any call did not report it", () => {
  const total = sumLlmUsage([
    { promptTokens: 10, completionTokens: 5, costUsd: 0.001 },
    { promptTokens: 20, completionTokens: 10, costUsd: null },
  ]);
  // A confident 0.001 here would read as the whole cost of both calls.
  assertEquals(total.costUsd, null);
  assertEquals(total.promptTokens, 30);
});

Deno.test("sumLlmUsage over no calls is unknown, not zero", () => {
  assertEquals(sumLlmUsage([]), emptyLlmUsage());
});

Deno.test("usageAttrs omits what was never reported", () => {
  assertEquals(usageAttrs({ promptTokens: 7, completionTokens: null, costUsd: null }), {
    llm_prompt_tokens: 7,
  });
});
