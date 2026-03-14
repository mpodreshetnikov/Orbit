import { describe, expect, it } from "vitest";
import { describeMoneyCategoryPipelineError } from "./money-category-pipeline-ui";

describe("describeMoneyCategoryPipelineError", () => {
  const t = (key: string) => key;

  it("maps missing openrouter config to a specific llm message", () => {
    expect(describeMoneyCategoryPipelineError(new Error("OPENROUTER_API_KEY is required"), t)).toBe(
      "LLM rule preview is unavailable because OPENROUTER_API_KEY is not configured for the local money-categorize function.",
    );
  });

  it("maps timeout failures to a specific timeout message", () => {
    expect(
      describeMoneyCategoryPipelineError(new Error("Money categorize request timed out"), t),
    ).toBe(
      "The rule pipeline timed out before it could finish. Try again, or check the local money-categorize function logs.",
    );
  });

  it("maps auth failures to a specific auth message", () => {
    expect(describeMoneyCategoryPipelineError(new Error("Unauthorized"), t)).toBe(
      "The rule pipeline request is not authenticated. Sign in again and retry.",
    );
  });
});
