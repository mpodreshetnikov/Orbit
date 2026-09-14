import { assertEquals } from "std/assert/assert-equals";
import { DEFAULT_OPENROUTER_MODEL } from "./llm-model.ts";

/**
 * The outage this constant was extracted for was not a wrong model — it was a live model wearing
 * a variant suffix that OpenRouter had stopped accepting, which answers `404` exactly as a
 * deleted model does. The suffix is a separate namespace from the model and can be withdrawn on
 * its own, so a default that carries one is a default that can die without the model moving.
 *
 * Overrides are still free to name one: `OPENROUTER_HEALTH_OCR_MODEL` and its siblings are set by
 * a deployment that can watch what it asked for. This is only about the value every pipeline
 * falls back to when nothing is set, which nobody is watching.
 */
Deno.test("the default model carries no variant suffix", () => {
  assertEquals(DEFAULT_OPENROUTER_MODEL.includes(":"), false, DEFAULT_OPENROUTER_MODEL);
});

Deno.test("the default model is a fully qualified OpenRouter id", () => {
  assertEquals(/^[a-z0-9-]+\/[a-zA-Z0-9._-]+$/.test(DEFAULT_OPENROUTER_MODEL), true);
});
