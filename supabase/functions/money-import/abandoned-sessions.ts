import type { EdgeTelemetry } from "../_shared/observability.ts";
import { normalizeText, toIsoOrNull } from "./normalize.ts";
import type { MoneyImportRepository } from "./repository.ts";

/** Written into `meta.failure_reason` of a session, and of its batch, closed for having expired. */
export const SESSION_EXPIRED_REASON = "session_expired";

/**
 * Batch statuses a dead session takes down with it. `pending` is a preview waiting for a person
 * to apply or discard it and outlives its session; `completed`, `failed` and `discarded` are
 * already final.
 */
const OPEN_BATCH_STATUSES: ReadonlySet<string> = new Set(["created", "running"]);

export interface CloseAbandonedSessionsDeps {
  repository: MoneyImportRepository;
  now?: () => Date;
  telemetry?: EdgeTelemetry;
}

export interface AbandonedSessionScope {
  source: string;
  payerPersonId: string;
}

export interface CloseAbandonedSessionsResult {
  sessions: number;
  batches: number;
}

/**
 * Closes every session of this source and payer that expired without a terminal status, and
 * the batch each of them was running.
 *
 * The server learns that a run ended only from the client: `complete_session` is the client's
 * word. A run that dies -- its service worker killed on a long wait, the browser closed --
 * says nothing, and its batch stayed `running` on the history screen for good (batch
 * `f89f5b61`, 2026-09-03). The session's expiry is the one fact the server holds on its own,
 * so the server draws the line: past `expires_at` with no completion the run is over, and what
 * it left behind is closed as failed with the reason written on it.
 *
 * Best-effort by design. This runs inside actions that have their own job to do, and a
 * bookkeeping failure must not refuse a new session or an import context.
 */
export async function closeAbandonedSessions(
  deps: CloseAbandonedSessionsDeps,
  scope: AbandonedSessionScope,
): Promise<CloseAbandonedSessionsResult> {
  const result: CloseAbandonedSessionsResult = { sessions: 0, batches: 0 };
  const listExpired = deps.repository.listExpiredOpenSessions;
  if (!listExpired) return result;

  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  let expired: Record<string, unknown>[];
  try {
    expired = await listExpired(scope.source, scope.payerPersonId, nowIso);
  } catch (error) {
    deps.telemetry?.warn("money_import_abandoned_session_scan_failed", {
      source: scope.source,
      error_message: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  for (const session of expired) {
    const sessionId = normalizeText(session.id);
    if (!sessionId) continue;
    const batchId = normalizeText(session.batch_id);
    const expiredAt = toIsoOrNull(session.expires_at) ?? nowIso;
    try {
      await deps.repository.updateImportSession(sessionId, {
        status: "failed",
        revoked_at: nowIso,
        updated_at: nowIso,
        meta: withFailureReason(session.meta),
      });
      result.sessions += 1;

      let batchClosed = false;
      if (batchId) {
        const batch = await deps.repository.getImportBatch(batchId);
        if (batch && OPEN_BATCH_STATUSES.has(normalizeText(batch.status) ?? "")) {
          await deps.repository.updateImportBatch(batchId, {
            status: "failed",
            // The run ended when its session did, not when somebody noticed.
            completed_at: expiredAt,
            meta: withFailureReason(batch.meta),
          });
          result.batches += 1;
          batchClosed = true;
        }
      }
      deps.telemetry?.info("money_import_abandoned_session_closed", {
        session_id: sessionId,
        batch_id: batchId,
        batch_closed: batchClosed,
        expired_at: expiredAt,
      });
    } catch (error) {
      deps.telemetry?.warn("money_import_abandoned_session_close_failed", {
        session_id: sessionId,
        batch_id: batchId,
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

function withFailureReason(meta: unknown): Record<string, unknown> {
  const base =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : {};
  return { ...base, failure_reason: SESSION_EXPIRED_REASON };
}
