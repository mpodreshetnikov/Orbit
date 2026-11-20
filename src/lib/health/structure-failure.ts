/**
 * The browser's half of the structuring failure vocabulary.
 *
 * `medical_records.structure_error` is written by two writers — the `health-structure` edge
 * function, and this browser when the call never got far enough for the server to write anything.
 * Both write the same shape: a cause code the UI can translate, then an English summary for whoever
 * reads the column directly.
 *
 * The server's half is `supabase/functions/health-structure/failure.ts`, which cannot be imported
 * here (it is Deno, deployed from its own directory) or there. `structure-failure.test.ts` reads
 * that file and fails when the two vocabularies drift apart.
 *
 * Parallel to OCR rather than shared: structuring never sees attachments, so OCR media /
 * unreadable-document causes are not meaningful here.
 */

/** Causes the edge function reports. Kept in the order the server file declares them. */
export const SERVER_STRUCTURE_CAUSES = [
  "provider_auth",
  "provider_no_endpoint",
  "provider_rejected",
  "provider_unavailable",
  "internal",
] as const;

/**
 * Causes only this side can report: the failures that happen before the server has a say.
 *
 * They exist so the browser never has to fall back to composing a free-text sentence of its own
 * — the thing that used to replace whatever the service had just carefully stored.
 */
export const CLIENT_STRUCTURE_CAUSES = ["service_unreachable", "not_authenticated"] as const;

export type StructureFailureCause =
  | (typeof SERVER_STRUCTURE_CAUSES)[number]
  | (typeof CLIENT_STRUCTURE_CAUSES)[number];

const ALL_CAUSES: readonly string[] = [...SERVER_STRUCTURE_CAUSES, ...CLIENT_STRUCTURE_CAUSES];

/** Mirrors `STRUCTURE_CAUSE_PREFIX` in the edge function. */
export const STRUCTURE_CAUSE_PREFIX = "structure_cause:";

/**
 * The same cap the edge function applies before it writes the column.
 *
 * Held here too, because this side is the last writer on some paths and an uncapped write is how
 * a provider's several-kilobyte answer used to reach a column meant for 500 characters.
 */
export const MAX_STRUCTURE_ERROR_LENGTH = 500;

function clientStructureSummary(cause: (typeof CLIENT_STRUCTURE_CAUSES)[number]): string {
  switch (cause) {
    case "service_unreachable":
      return "the structuring service could not be reached";
    case "not_authenticated":
      return "the session is not signed in";
  }
}

/** Compose a durable failure string for a failure that happened in the browser. */
export function formatClientStructureFailure(
  cause: (typeof CLIENT_STRUCTURE_CAUSES)[number],
  detail?: string,
): string {
  const summary = clientStructureSummary(cause);
  const composed = `${STRUCTURE_CAUSE_PREFIX}${cause} ${detail ? `${summary}: ${detail}` : summary}`;
  return composed.slice(0, MAX_STRUCTURE_ERROR_LENGTH);
}

/** The cause a stored message carries, or null for a message written before this vocabulary. */
export function parseStructureFailureCause(
  message: string | null | undefined,
): StructureFailureCause | null {
  if (!message?.startsWith(STRUCTURE_CAUSE_PREFIX)) return null;
  const code = message.slice(STRUCTURE_CAUSE_PREFIX.length).split(/\s/, 1)[0];
  return ALL_CAUSES.includes(code) ? (code as StructureFailureCause) : null;
}

/**
 * Make a failure the browser is about to persist translatable.
 *
 * Anything already classified is left as it is. Unclassified server explanations stay as capped
 * prose so the toast and banner keep the actionable detail. Only real transport failures become
 * `service_unreachable`.
 */
export function durableClientStructureFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (parseStructureFailureCause(raw)) {
    // Cap even when the server already classified — the column is 500 characters.
    return raw.slice(0, MAX_STRUCTURE_ERROR_LENGTH);
  }
  if (/not authenticated/i.test(raw)) {
    return formatClientStructureFailure("not_authenticated");
  }
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(raw)
  ) {
    return formatClientStructureFailure("service_unreachable", raw || "processing failed");
  }
  return (raw || "Structure extraction failed").slice(0, MAX_STRUCTURE_ERROR_LENGTH);
}

/**
 * What to show the user for a stored failure.
 *
 * A classified message becomes a translated sentence. Anything else is shown as it stands: rows
 * written before this vocabulary existed still carry an English sentence, and an untranslated
 * sentence beats no explanation at all.
 */
export function translateStructureFailure(
  message: string | null | undefined,
  t: (key: string) => string,
  fallbackKey = "processing.structureFailed",
): string {
  const cause = parseStructureFailureCause(message);
  if (cause) return t(`processing.structureCause.${cause}`);
  return message || t(fallbackKey);
}
