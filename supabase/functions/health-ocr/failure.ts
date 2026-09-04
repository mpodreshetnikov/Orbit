/**
 * What an OCR failure was, in a fixed vocabulary, and the durable string that carries it.
 *
 * `medical_records.ocr_error` is the only thing a user ever sees about a failed transcription,
 * and it used to say `Failed to extract text from any attachment` whatever had happened — so a
 * rejected API key read as a bad photograph, and the first move it invited was re-shooting a
 * document that was never the problem.
 *
 * Two constraints shape what goes in the column:
 *
 * - The provider's own error body is never quoted. It can echo the request, and for OCR the
 *   request is the patient's document; `openrouter-client.ts` already declines to read it for
 *   exactly this reason. Every string here is composed from our own vocabulary and from numbers.
 * - The reader is a browser in a language the server does not know. So the cause travels as a
 *   machine-readable code that the UI translates, with an English summary after it for the logs
 *   and for anyone reading the column directly.
 *
 * The client half of this vocabulary lives in `src/lib/health/ocr-failure.ts`; the two are kept
 * in step by `src/lib/health/ocr-failure.test.ts`, which reads this file.
 */

import { INVALID_JSON_ERROR_MESSAGE } from "../_shared/llm-json.ts";

/** The provider answered, but with no content to transcribe from. */
export const NO_PROVIDER_RESPONSE_MESSAGE = "No response from OpenRouter";

export type OcrFailureCause =
  /** The transcription service rejected our credentials. A configuration problem, not a document. */
  | "provider_auth"
  /**
   * The service found no endpoint able to take the request as configured.
   *
   * OpenRouter answers 404 for two configuration faults that look identical from here: a model id
   * that names nothing it serves, and — because `require_parameters` is all-or-nothing — a
   * request asking for a parameter no endpoint for that model advertises. Both are "nothing to
   * route to", neither is about the document, and the response does not say which. So the cause
   * names the routing failure rather than guessing at the model, and the remedy is to look at the
   * configured id *and* the request options.
   *
   * Separated from `provider_rejected`, which is the service refusing a request it could route.
   * Never per-document: seeing it once means every document is failing.
   */
  | "provider_no_endpoint"
  /** The service refused the request itself — an unsupported parameter, a body it would not take. */
  | "provider_rejected"
  /** Rate limited, unavailable, timed out, or answered with something unusable. Worth retrying. */
  | "provider_unavailable"
  /** The attachment is of a type that cannot be sent for transcription. */
  | "unsupported_media"
  /** The stored file could not be read back, or is larger than this function will send. */
  | "attachment_unavailable"
  /** The service read the page and found no text in it. This is the one a better photo fixes. */
  | "unreadable_document"
  /** The page was longer than the completion budget, so only its beginning was transcribed. */
  | "truncated_page"
  /** The record has no attachments to transcribe. */
  | "no_attachments"
  /** Anything the classification above does not recognise. */
  | "internal";

/**
 * Which cause a document reports when its pages failed for different reasons.
 *
 * Ordered by what the reader should do about it, most actionable first: a rejected key is worth
 * naming even if four of five pages were merely unreadable, because fixing it is what makes the
 * next run different.
 */
const CAUSE_PRECEDENCE: OcrFailureCause[] = [
  "provider_auth",
  "provider_no_endpoint",
  "provider_rejected",
  "unsupported_media",
  "attachment_unavailable",
  "provider_unavailable",
  "truncated_page",
  "unreadable_document",
  "no_attachments",
  "internal",
];

/** The marker that tells a reader this column holds a classified cause rather than free prose. */
export const OCR_CAUSE_PREFIX = "ocr_cause:";

/**
 * An error that already knows what class of failure it is.
 *
 * The field is `failureCause` rather than `cause`, which `Error` has taken for the error it
 * wraps.
 */
export class OcrFailureError extends Error {
  constructor(
    readonly failureCause: OcrFailureCause,
    message: string,
  ) {
    super(message);
    this.name = "OcrFailureError";
  }
}

/** A non-retryable answer from the provider, carrying the status that made it non-retryable. */
export class OcrProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OcrProviderError";
  }
}

/** An attachment whose MIME type cannot be sent for transcription. */
export class UnsupportedOcrMediaError extends Error {
  constructor(readonly mimeType: string) {
    super(`Unsupported OCR attachment MIME type: ${mimeType}`);
    this.name = "UnsupportedOcrMediaError";
  }
}

/**
 * Classify one page's failure.
 *
 * The distinction this preserves is the one the retry policy already made: `RetryableLlmError`
 * survives the retry loop only when every attempt was spent, so reaching here means the provider
 * was unavailable for as long as we were willing to wait. A non-retryable status arrives
 * immediately and deliberately — retrying a rejected key is pointless — so by this point the
 * code already knows it was a configuration failure rather than a bad photograph.
 */
export function classifyOcrError(error: unknown): OcrFailureCause {
  if (error instanceof OcrFailureError) return error.failureCause;
  if (error instanceof UnsupportedOcrMediaError) return "unsupported_media";
  if (error instanceof OcrProviderError) {
    if (error.status === 401 || error.status === 403) return "provider_auth";
    // 404 from the completions endpoint never means "route not found" in the HTTP sense — the
    // path is fixed. It means OpenRouter had no endpoint to send this to: an unserved model id,
    // or a parameter no endpoint for that model advertises while `require_parameters` is on.
    // Reported as itself because it is the one provider failure no retry and no better
    // photograph can fix — the configuration has to change.
    if (error.status === 404) return "provider_no_endpoint";
    return "provider_rejected";
  }
  if (error instanceof Error && error.name === "RetryableLlmError") return "provider_unavailable";
  // A provider answer we could not read is not the document's fault and may not recur, so it is
  // reported the same way an unavailable provider is: worth another attempt.
  if (
    error instanceof Error &&
    (error.message === NO_PROVIDER_RESPONSE_MESSAGE || error.message === INVALID_JSON_ERROR_MESSAGE)
  ) {
    return "provider_unavailable";
  }
  return "internal";
}

/** The cause a whole document reports, given what each of its pages reported. */
export function dominantCause(causes: OcrFailureCause[]): OcrFailureCause {
  for (const candidate of CAUSE_PRECEDENCE) {
    if (causes.includes(candidate)) return candidate;
  }
  return "internal";
}

const CAUSE_SUMMARIES: Record<OcrFailureCause, string> = {
  provider_auth: "the transcription service rejected this deployment's credentials",
  provider_no_endpoint: "the transcription service could not route the request as configured",
  provider_rejected: "the transcription service refused the request",
  provider_unavailable: "the transcription service was unavailable",
  unsupported_media: "the file type cannot be transcribed",
  attachment_unavailable: "the stored file could not be read",
  unreadable_document: "no text could be read from the document",
  truncated_page: "the document was longer than one transcription pass could hold",
  no_attachments: "the record has no attachments",
  internal: "the transcription failed for an unexpected reason",
};

/**
 * Compose the string the column carries: the code first, then an English summary.
 *
 * The code leads so that truncation — the column is capped at 500 characters — can only ever
 * cost detail, never the cause itself.
 */
export function formatOcrFailure(cause: OcrFailureCause, detail?: string): string {
  const summary = CAUSE_SUMMARIES[cause];
  return `${OCR_CAUSE_PREFIX}${cause} ${detail ? `${summary}: ${detail}` : summary}`;
}

/**
 * What a run that still succeeded did not bring back.
 *
 * Its own wording, because "failed" is wrong for a document the user can read: these pages are
 * missing or cut short inside a transcription that otherwise worked.
 */
export function partialPageDetail(incomplete: number, total: number): string {
  return `${incomplete} of ${total} page${total === 1 ? "" : "s"} did not come back complete`;
}

/** How many of how many pages failed, in a form that has no document text in it. */
export function pageCountDetail(failed: number, total: number): string {
  return failed === total
    ? `all ${total} page${total === 1 ? "" : "s"} failed`
    : `${failed} of ${total} pages failed`;
}
