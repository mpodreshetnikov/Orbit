import { assertEquals } from "std/assert/assert-equals";
import { RetryableLlmError } from "../_shared/llm-retry.ts";
import {
  classifyStructureError,
  formatStructureFailure,
  StructureProviderError,
} from "./failure.ts";

Deno.test("classifyStructureError maps provider status codes", () => {
  assertEquals(classifyStructureError(new StructureProviderError("x", 401)), "provider_auth");
  assertEquals(
    classifyStructureError(new StructureProviderError("x", 404)),
    "provider_no_endpoint",
  );
  assertEquals(classifyStructureError(new StructureProviderError("x", 400)), "provider_rejected");
});

Deno.test("classifyStructureError maps retryable and timeout messages", () => {
  assertEquals(classifyStructureError(new RetryableLlmError("retry")), "provider_unavailable");
  assertEquals(classifyStructureError(new Error("OpenRouter timeout")), "provider_unavailable");
  assertEquals(
    classifyStructureError(new Error("OpenRouter request failed: 404")),
    "provider_no_endpoint",
  );
});

Deno.test("formatStructureFailure leads with the cause code", () => {
  const message = formatStructureFailure("provider_auth", "detail");
  assertEquals(message.startsWith("structure_cause:provider_auth "), true);
  assertEquals(message.includes("detail"), true);
});
