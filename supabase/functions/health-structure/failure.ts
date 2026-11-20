/**
 * What a structuring failure was, in a fixed vocabulary, and the durable string that carries it.
 *
 * `medical_records.structure_error` is the only thing a user ever sees about a failed structuring
 * run, and it used to quote raw English like `OpenRouter request failed: 404` — so a missing model
 * id read as provider prose in an otherwise Russian UI, with no code the client could translate.
 *
 * Two constraints shape what goes in the column:
 *
 * - The provider's own error body is never quoted. The staged client already composes status-only
 *   messages; every string here is from our own vocabulary and from numbers.
 * - The reader is a browser in a language the server does not know. So the cause travels as a
 *   machine-readable code that the UI translates, with an English summary after it for the logs
 *   and for anyone reading the column directly.
 *
 * The client half of this vocabulary lives in `src/lib/health/structure-failure.ts`; the two are
 * kept in step by `src/lib/health/structure-failure.test.ts`, which reads this file.
 *
 * Parallel to OCR rather than shared: structuring never sees attachments, so OCR media /
 * unreadable-document causes are not meaningful here.
 */

import { INVALID_JSON_ERROR_MESSAGE } from "../_shared/llm-json.ts";

/** Mirrors `TRUNCATED_ERROR_MESSAGE` in `stages/client.ts` without importing that module. */
const TRUNCATED_ERROR_MESSAGE = "OpenRouter response was truncated before completion";

export type StructureFailureCause =
  /** The structuring service rejected our credentials. A configuration problem, not a document. */
  | "provider_auth"
  /**
   * The service found no endpoint able to take the request as configured.
   *
   * OpenRouter answers 404 for an unserved model id or a parameter no endpoint advertises while
   * `require_parameters` is on. Reported as itself because no retry and no better document fixes
   * it — the configuration has to change.
   */
  | "provider_no_endpoint"
  /** The service refused the request itself — an unsupported parameter, a body it would not take. */
  | "provider_rejected"
  /** Rate limited, unavailable, timed out, truncated, or answered with something unusable. */
  | "provider_unavailable"
  /** Anything the classification above does not recognise. */
  | "internal";

/** The marker that tells a reader this column holds a classified cause rather than free prose. */
export const STRUCTURE_CAUSE_PREFIX = "structure_cause:";

/** Cap shared with the client half; truncation must never cost the leading cause code. */
export const MAX_STRUCTURE_ERROR_LENGTH = 500;

/**
 * An error that already knows what class of failure it is.
 *
 * The field is `failureCause` rather than `cause`, which `Error` has taken for the error it wraps.
 */
export class StructureFailureError extends Error {
  constructor(
    readonly failureCause: StructureFailureCause,
    message: string,
  ) {
    super(message);
    this.name = "StructureFailureError";
  }
}

/** A non-retryable answer from the provider, carrying the status that made it non-retryable. */
export class StructureProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StructureProviderError";
  }
}

/**
 * Classify one structuring failure.
 *
 * The distinction this preserves is the one the retry policy already made: `RetryableLlmError`
 * survives the retry loop only when every attempt was spent, so reaching here means the provider
 * was unavailable for as long as we were willing to wait. A non-retryable status arrives
 * immediately and deliberately.
 */
export function classifyStructureError(error: unknown): StructureFailureCause {
  if (error instanceof StructureFailureError) return error.failureCause;
  if (error instanceof StructureProviderError) {
    if (error.status === 401 || error.status === 403) return "provider_auth";
    if (error.status === 404) return "provider_no_endpoint";
    return "provider_rejected";
  }
  if (error instanceof Error && error.name === "RetryableLlmError") return "provider_unavailable";
  if (
    error instanceof Error &&
    (error.message === INVALID_JSON_ERROR_MESSAGE ||
      error.message === TRUNCATED_ERROR_MESSAGE ||
      /timed?\s*out/i.test(error.message) ||
      /timeout/i.test(error.message))
  ) {
    return "provider_unavailable";
  }
  // Legacy / openrouter-parse paths still throw a plain Error with the status in the message.
  if (error instanceof Error) {
    const statusMatch = error.message.match(/OpenRouter request failed:\s*(\d{3})\b/i);
    if (statusMatch) {
      const status = Number(statusMatch[1]);
      if (status === 401 || status === 403) return "provider_auth";
      if (status === 404) return "provider_no_endpoint";
      if (status === 429 || status >= 500) return "provider_unavailable";
      return "provider_rejected";
    }
  }
  return "internal";
}

const CAUSE_SUMMARIES: Record<StructureFailureCause, string> = {
  provider_auth: "the structuring service rejected this deployment's credentials",
  provider_no_endpoint: "the structuring service could not route the request as configured",
  provider_rejected: "the structuring service refused the request",
  provider_unavailable: "the structuring service was unavailable",
  internal: "structuring failed for an unexpected reason",
};

/**
 * Compose the string the column carries: the code first, then an English summary.
 *
 * The code leads so that truncation — the column is capped at 500 characters — can only ever
 * cost detail, never the cause itself.
 */
export function formatStructureFailure(cause: StructureFailureCause, detail?: string): string {
  const summary = CAUSE_SUMMARIES[cause];
  const composed = `${STRUCTURE_CAUSE_PREFIX}${cause} ${detail ? `${summary}: ${detail}` : summary}`;
  return composed.slice(0, MAX_STRUCTURE_ERROR_LENGTH);
}
