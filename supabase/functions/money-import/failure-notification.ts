import { normalizeText } from "./normalize.ts";

/**
 * The push a person gets when an import they did not start ends in failure.
 *
 * An unattended run takes long enough that nobody watches it, and the extension keeps its
 * failures to itself: before this, a signed-out bank showed up only as data that had quietly
 * stopped arriving. The server is where it is decided, because `complete_session` is already
 * called on every failed window -- by the run itself and by the extension's janitor after a
 * worker died -- so versions already installed notify without an update.
 */
export const MONEY_IMPORT_FAILED_NOTIFICATION_TYPE = "money_import_failed";

/**
 * Why a window was closed as failed without having failed. The extension sends it when it gives
 * a window back because a person's own import took the session field: nothing went wrong, and
 * the person is at the screen.
 */
export const SUPERSEDED_COMPLETION_REASON = "superseded";

const SOURCE_LABELS: Record<string, string> = {
  tbank_web: "T-Bank",
  alfa_web: "Alfa-Bank",
};

function readMeta(session: Record<string, unknown>): Record<string, unknown> {
  const meta = session.meta;
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

export interface FailedRunNotificationInput {
  /** The session row as it was before this completion. */
  session: Record<string, unknown>;
  /** The batch's status before this completion, when it has one. */
  batchStatus: string | null;
  reason: string | null;
}

/**
 * Whether this failed completion is an automatic run the person should hear about.
 *
 * Only the sweep's own runs: a person who imported by hand, or pressed Update on the attention
 * page, is looking at the bank tab and its widget already says how it ended. Only the catch-up
 * window: a history slice that fails is taken again next time, and the fresh data it follows
 * has already landed. A batch already applied is not a failure -- the last request can fail
 * after the server applied it. Sessions written before the extension named its origin and
 * window carry neither, and are read as the sweep's catch-up window, which is what most were.
 */
export function shouldNotifyFailedRun(input: FailedRunNotificationInput): boolean {
  const { session, batchStatus, reason } = input;
  if (reason === SUPERSEDED_COMPLETION_REASON) return false;
  const status = normalizeText(session.status);
  if (status === "completed" || status === "failed") return false;
  if (batchStatus === "completed") return false;
  if (!normalizeText(session.created_by_auth_user_id)) return false;

  const meta = readMeta(session);
  if (meta.unattended !== true) return false;
  const origin = normalizeText(meta.run_origin);
  if (origin && origin !== "auto") return false;
  const windowKind = normalizeText(meta.window_kind);
  if (windowKind === "backfill") return false;
  return true;
}

/** The `notification_digests` row: due now, sent on the next `notifications-cron` tick. */
export function buildFailedRunNotification(
  session: Record<string, unknown>,
  nowIso: string,
): Record<string, unknown> {
  const source = normalizeText(session.source) ?? "";
  const label = SOURCE_LABELS[source] ?? source;
  // The report of the run that failed, where its reason is: the import page itself said
  // nothing about this run (2026-10-28). History is the fallback for a session without a batch.
  const batchId = normalizeText(session.batch_id);
  const url = batchId
    ? `/money/import/reports/${encodeURIComponent(batchId)}`
    : "/money/import/history";
  return {
    auth_user_id: normalizeText(session.created_by_auth_user_id),
    // Addressed to whoever set up automatic import, not routed by person: routing decides whose
    // health reminders a member gets, and this is about the credential they hold.
    person_id: null,
    type: MONEY_IMPORT_FAILED_NOTIFICATION_TYPE,
    scheduled_at: nowIso,
    payload_json: {
      // English fallbacks; the service worker words it in the app's language from `source`.
      title: "Automatic import failed",
      body: label
        ? `${label}: the import did not go through. You may need to sign in to the bank.`
        : "The import did not go through. You may need to sign in to the bank.",
      url,
      // Also what the service worker groups by, so a second failure replaces the first.
      source,
    },
  };
}
