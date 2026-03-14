export function translateOrFallback(t: (key: string) => string, key: string, fallback: string) {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

export function describeMoneyCategoryPipelineError(error: unknown, t: (key: string) => string) {
  const message = error instanceof Error ? error.message : "";

  if (/line item .* was not found for category pipeline/i.test(message)) {
    return translateOrFallback(
      t,
      "money.rulePipelineErrorMissingLineItem",
      "The selected line item is no longer available. Choose another line item and try again.",
    );
  }

  if (/transaction .* was not found for category pipeline/i.test(message)) {
    return translateOrFallback(
      t,
      "money.rulePipelineErrorMissingTransaction",
      "The selected transaction is no longer available. Choose another transaction and try again.",
    );
  }

  if (/OPENROUTER_API_KEY is required/i.test(message)) {
    return translateOrFallback(
      t,
      "money.rulePipelineErrorLlmUnavailable",
      "LLM rule preview is unavailable because OPENROUTER_API_KEY is not configured for the local money-categorize function.",
    );
  }

  if (/Money categorize request timed out/i.test(message)) {
    return translateOrFallback(
      t,
      "money.rulePipelineErrorTimeout",
      "The rule pipeline timed out before it could finish. Try again, or check the local money-categorize function logs.",
    );
  }

  if (/Missing Authorization header|Unauthorized|Not authenticated/i.test(message)) {
    return translateOrFallback(
      t,
      "money.rulePipelineErrorUnauthorized",
      "The rule pipeline request is not authenticated. Sign in again and retry.",
    );
  }

  return translateOrFallback(
    t,
    "money.rulePipelineErrorGeneric",
    "The rule pipeline could not run. Check the selected transaction or line item and try again.",
  );
}
