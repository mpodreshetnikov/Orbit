/**
 * The browser's half of the OCR failure vocabulary.
 *
 * `medical_records.ocr_error` is written by two writers — the `health-ocr` edge function, and
 * this browser when the call to it never got far enough for the server to write anything. Both
 * write the same shape: a cause code the UI can translate, then an English summary for whoever
 * reads the column directly.
 *
 * The server's half is `supabase/functions/health-ocr/failure.ts`, which cannot be imported here
 * (it is Deno, deployed from its own directory) or there. `ocr-failure.test.ts` reads that file
 * and fails when the two vocabularies drift apart.
 */

/** Causes the edge function reports. Kept in the order the server file declares them. */
export const SERVER_OCR_CAUSES = [
  "provider_auth",
  "provider_rejected",
  "provider_unavailable",
  "unsupported_media",
  "attachment_unavailable",
  "unreadable_document",
  "truncated_page",
  "no_attachments",
  "internal",
] as const;

/**
 * Causes only this side can report: the failures that happen before the server has a say.
 *
 * They exist so the browser never has to fall back to composing a free-text sentence of its own
 * — the thing that used to replace whatever the service had just carefully stored.
 */
export const CLIENT_OCR_CAUSES = [
  "service_unreachable",
  "not_authenticated",
  "upload_failed",
] as const;

export type OcrFailureCause =
  | (typeof SERVER_OCR_CAUSES)[number]
  | (typeof CLIENT_OCR_CAUSES)[number];

const ALL_CAUSES: readonly string[] = [...SERVER_OCR_CAUSES, ...CLIENT_OCR_CAUSES];

/** Mirrors `OCR_CAUSE_PREFIX` in the edge function. */
export const OCR_CAUSE_PREFIX = "ocr_cause:";

/**
 * The same cap the edge function applies before it writes the column.
 *
 * Held here too, because this side is the last writer on some paths and an uncapped write is how
 * a provider's several-kilobyte answer used to reach a column meant for 500 characters.
 */
export const MAX_OCR_ERROR_LENGTH = 500;

const CLIENT_SUMMARIES: Record<(typeof CLIENT_OCR_CAUSES)[number], string> = {
  service_unreachable: "the transcription service could not be reached",
  not_authenticated: "the session is not signed in",
  upload_failed: "the document could not be uploaded",
};

/** Compose a durable failure string for a failure that happened in the browser. */
export function formatClientOcrFailure(
  cause: (typeof CLIENT_OCR_CAUSES)[number],
  detail?: string,
): string {
  const summary = CLIENT_SUMMARIES[cause];
  const composed = `${OCR_CAUSE_PREFIX}${cause} ${detail ? `${summary}: ${detail}` : summary}`;
  return composed.slice(0, MAX_OCR_ERROR_LENGTH);
}

/** The cause a stored message carries, or null for a message written before this vocabulary. */
export function parseOcrFailureCause(message: string | null | undefined): OcrFailureCause | null {
  if (!message?.startsWith(OCR_CAUSE_PREFIX)) return null;
  const code = message.slice(OCR_CAUSE_PREFIX.length).split(/\s/, 1)[0];
  return ALL_CAUSES.includes(code) ? (code as OcrFailureCause) : null;
}

/**
 * What to show the user for a stored failure.
 *
 * A classified message becomes a translated sentence. Anything else is shown as it stands: rows
 * written before this vocabulary existed still carry an English sentence, and an untranslated
 * sentence beats no explanation at all.
 */
export function translateOcrFailure(
  message: string | null | undefined,
  t: (key: string) => string,
  fallbackKey = "processing.failed",
): string {
  const cause = parseOcrFailureCause(message);
  if (cause) return t(`processing.ocrCause.${cause}`);
  return message || t(fallbackKey);
}
