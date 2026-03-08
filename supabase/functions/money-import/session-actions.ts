import { computeProgressPercent } from "./progress.ts";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import {
  jsonResponse,
  normalizeSourceForTransactions,
  normalizeText,
  randomSessionToken,
  sha256Hex,
  toIsoOrNull,
} from "./normalize.ts";
import type { AuthContext, UserAuthContext } from "./types.ts";
import type { MoneyImportRepository } from "./repository.ts";

export const DEFAULT_SESSION_TTL_MINUTES = 15;

interface SessionActionDeps {
  repository: MoneyImportRepository;
  now?: () => Date;
  sessionTtlMinutes?: number;
  telemetry?: EdgeTelemetry;
}

export async function createSessionAction(
  body: Record<string, unknown>,
  auth: UserAuthContext,
  deps: SessionActionDeps,
): Promise<Response> {
  const span = deps.telemetry?.startSpan("edge.money_import.create_session");
  const source = normalizeText(body.source);
  const payerPersonId = normalizeText(body.payer_person_id);
  if (!source || !payerPersonId) {
    await span?.end({
      status: "error",
      statusMessage: "source and payer_person_id are required",
    });
    return jsonResponse({ error: "source and payer_person_id are required" }, 400);
  }

  const now = (deps.now ?? (() => new Date()))();
  const sessionTtlMinutes = deps.sessionTtlMinutes ?? DEFAULT_SESSION_TTL_MINUTES;
  const expiresAt = new Date(now.getTime() + sessionTtlMinutes * 60 * 1000).toISOString();

  const token = randomSessionToken();
  const tokenHash = await sha256Hex(token);
  const windowFrom = toIsoOrNull(body.window_from);
  const windowTo = toIsoOrNull(body.window_to);

  const session = await deps.repository.createImportSession({
    token_hash: tokenHash,
    source,
    payer_person_id: payerPersonId,
    created_by_auth_user_id: auth.userId,
    status: "created",
    window_from: windowFrom,
    window_to: windowTo,
    expires_at: expiresAt,
    meta: body.meta ?? null,
  });

  const batchId = await deps.repository.createImportBatch({
    source,
    payer_person_id: payerPersonId,
    import_type: "web_export",
    file_path: null,
    meta: body.meta ?? null,
    session_id: session.id,
    status: "running",
    window_from: windowFrom,
    window_to: windowTo,
  });

  await deps.repository.updateImportSession(session.id, {
    batch_id: batchId,
    status: "running",
    window_from: windowFrom,
    window_to: windowTo,
    updated_at: now.toISOString(),
  });

  const lastImportedAt = await deps.repository.findLastImportedAt(
    normalizeSourceForTransactions(source),
    payerPersonId,
  );
  deps.telemetry?.info("money_import_create_session_completed", {
    session_id: session.id,
    batch_id: batchId,
    source,
  });
  await span?.end({
    status: "ok",
    attrs: {
      source,
      has_last_imported_at: Boolean(lastImportedAt),
    },
  });

  return jsonResponse({
    session_id: session.id,
    session_token: token,
    batch_id: batchId,
    source,
    payer_person_id: payerPersonId,
    expires_at: expiresAt,
    last_imported_at: lastImportedAt,
    ttl_minutes: sessionTtlMinutes,
  });
}

export async function sessionStatusAction(
  body: Record<string, unknown>,
  auth: UserAuthContext,
  deps: SessionActionDeps,
): Promise<Response> {
  const span = deps.telemetry?.startSpan("edge.money_import.session_status");
  const sessionId = normalizeText(body.session_id);
  if (!sessionId) {
    await span?.end({
      status: "error",
      statusMessage: "session_id is required",
    });
    return jsonResponse({ error: "session_id is required" }, 400);
  }

  const session = await deps.repository.getImportSessionForUser(sessionId, auth.userId);
  if (!session) {
    await span?.end({
      status: "error",
      statusMessage: "Session not found",
    });
    return jsonResponse({ error: "Session not found" }, 404);
  }

  const batchId = normalizeText(session.batch_id);
  const batch = batchId ? await deps.repository.getImportBatch(batchId) : null;

  const windowSource = batch ?? session;
  const windowFrom = toIsoOrNull(windowSource.window_from);
  const windowTo = toIsoOrNull(windowSource.window_to);
  const parsedThrough = toIsoOrNull(batch?.parsed_through_at);
  const progressPercent = computeProgressPercent(windowFrom, windowTo, parsedThrough);
  await span?.end({
    status: "ok",
    attrs: {
      session_id: sessionId,
      has_batch: Boolean(batch),
      progress_percent: progressPercent,
    },
  });

  return jsonResponse({
    session: {
      id: session.id,
      source: session.source,
      payer_person_id: session.payer_person_id,
      status: session.status,
      expires_at: session.expires_at,
      revoked_at: session.revoked_at,
      window_from: windowFrom,
      window_to: windowTo,
      batch_id: batchId,
    },
    batch: batch
      ? {
          id: batch.id,
          status: batch.status,
          parsed_transactions_count: batch.parsed_transactions_count,
          parsed_through_at: batch.parsed_through_at,
          inserted_count: batch.inserted_count,
          skipped_count: batch.skipped_count,
          error_count: batch.error_count,
          completed_at: batch.completed_at,
          window_from: batch.window_from,
          window_to: batch.window_to,
          progress_percent: progressPercent,
        }
      : null,
  });
}

export async function completeSessionAction(
  body: Record<string, unknown>,
  auth: AuthContext,
  deps: SessionActionDeps,
): Promise<Response> {
  const span = deps.telemetry?.startSpan("edge.money_import.complete_session");
  let sessionId = normalizeText(body.session_id);
  let batchId = normalizeText(body.batch_id);

  if (auth.mode === "session") {
    sessionId = normalizeText(auth.session.id) ?? sessionId;
    batchId = normalizeText(auth.session.batch_id) ?? batchId;
  }

  if (!sessionId) {
    await span?.end({
      status: "error",
      statusMessage: "session_id is required",
    });
    return jsonResponse({ error: "session_id is required" }, 400);
  }

  if (auth.mode === "user") {
    const ownedSession = await deps.repository.getImportSessionForUser(sessionId, auth.userId);
    if (!ownedSession) {
      await span?.end({
        status: "error",
        statusMessage: "Session not found",
      });
      return jsonResponse({ error: "Session not found" }, 404);
    }
    batchId = normalizeText(ownedSession.batch_id) ?? batchId;
  }

  const desiredStatus = normalizeText(body.status);
  const finalStatus = desiredStatus === "failed" ? "failed" : "completed";
  const batchStatus = finalStatus === "failed" ? "failed" : "completed";
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();

  await deps.repository.updateImportSession(sessionId, {
    status: finalStatus,
    revoked_at: nowIso,
    updated_at: nowIso,
  });

  if (batchId) {
    const batch = await deps.repository.getImportBatch(batchId);
    if (batch) {
      const currentBatchStatus = normalizeText(batch.status);
      const batchPatch: Record<string, unknown> = {};

      if (batchStatus === "failed") {
        batchPatch.status = "failed";
        batchPatch.completed_at = nowIso;
      } else if (currentBatchStatus === "completed") {
        batchPatch.completed_at = nowIso;
      }

      if (Object.keys(batchPatch).length > 0) {
        await deps.repository.updateImportBatch(batchId, batchPatch);
      }
    }
  }
  await span?.end({
    status: "ok",
    attrs: {
      session_id: sessionId,
      has_batch_id: Boolean(batchId),
      status: finalStatus,
    },
  });

  return jsonResponse({
    session_id: sessionId,
    batch_id: batchId,
    status: finalStatus,
  });
}
