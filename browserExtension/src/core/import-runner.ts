import type { Connector } from "../connectors/types.js";

export interface ImportRunnerDeps {
  getConnector: (sourceId: string) => Connector | null;
  callEdge: (
    functionUrl: string,
    token: string,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  broadcastToAppTabs: (message: Record<string, unknown>) => Promise<void>;
  nowIso: () => string;
}

type ProgressPhase = string;
const PREVIEW_ROWS_CHUNK_SIZE = 50;

export interface ImportRunnerDebugConfig {
  enabled?: boolean;
  parseOnly?: boolean;
  tabId?: number;
  debugRunId?: string;
  emit?: (event: string, attrs?: Record<string, unknown>) => void;
}

function resolveEdgeAuthToken(session: Record<string, unknown>): {
  token: string;
  token_mode: "user" | "session";
} {
  const userToken =
    typeof session.user_access_token === "string" ? session.user_access_token.trim() : "";
  if (userToken) {
    return { token: userToken, token_mode: "user" };
  }
  const sessionToken =
    typeof session.session_token === "string" ? session.session_token.trim() : "";
  return { token: sessionToken, token_mode: "session" };
}

function resolveEdgeTarget(functionUrl: unknown): {
  url: string | null;
  scheme: string | null;
  host: string | null;
  path: string | null;
} {
  if (typeof functionUrl !== "string" || !functionUrl.trim()) {
    return { url: null, scheme: null, host: null, path: null };
  }
  try {
    const parsed = new URL(functionUrl);
    return {
      url: functionUrl,
      scheme: parsed.protocol.replace(":", ""),
      host: parsed.host,
      path: parsed.pathname,
    };
  } catch {
    return { url: functionUrl, scheme: null, host: null, path: null };
  }
}

function extractErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {
      error_message: error instanceof Error ? error.message : String(error),
      error_code: null,
      edge_action: null,
      edge_host: null,
      edge_path: null,
      edge_http_status: null,
      edge_transport: null,
      edge_response_error: null,
      error_name: error instanceof Error ? error.name : null,
    };
  }

  const candidate = error as Record<string, unknown>;
  return {
    error_message: error instanceof Error ? error.message : "Unknown import error",
    error_code: typeof candidate.code === "string" ? candidate.code : null,
    edge_action: typeof candidate.action === "string" ? candidate.action : null,
    edge_host: typeof candidate.function_host === "string" ? candidate.function_host : null,
    edge_path: typeof candidate.function_path === "string" ? candidate.function_path : null,
    edge_http_status:
      typeof candidate.http_status === "number" && Number.isFinite(candidate.http_status)
        ? candidate.http_status
        : null,
    edge_transport: typeof candidate.transport === "string" ? candidate.transport : null,
    edge_response_error:
      typeof candidate.response_error === "string" ? candidate.response_error : null,
    error_name: error instanceof Error ? error.name : null,
  };
}

function buildProgressMessage(
  phase: ProgressPhase,
  progressPercent: number,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...payload,
    phase,
    progress_percent: progressPercent,
  };
}

async function broadcastProgress(
  deps: Pick<ImportRunnerDeps, "broadcastToAppTabs">,
  phase: ProgressPhase,
  progressPercent: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await deps.broadcastToAppTabs(buildProgressMessage(phase, progressPercent, payload));
}

function chunkPreviewRows<T>(rows: T[], chunkSize: number): T[][] {
  if (rows.length === 0) return [[]];

  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    chunks.push(rows.slice(start, start + chunkSize));
  }
  return chunks;
}

function resolvePreviewProgressPercent(chunkIndex: number, chunkCount: number): number {
  if (chunkCount <= 1) return 75;
  return 75 + Math.round((14 * chunkIndex) / (chunkCount - 1));
}

export async function runImportSession(
  session: Record<string, unknown>,
  windowFromInput: string | undefined,
  deps: ImportRunnerDeps,
  debug?: ImportRunnerDebugConfig,
): Promise<Record<string, unknown>> {
  const emit = (event: string, attrs?: Record<string, unknown>) => {
    if (!debug?.enabled) return;
    debug.emit?.(event, attrs);
  };
  const emitProgress = async (
    phase: string,
    progressPercent: number,
    payload?: Record<string, unknown>,
  ) => {
    await broadcastProgress(deps, phase, progressPercent, {
      type: "MONEY_IMPORT_PROGRESS",
      debug_run_id: debug?.debugRunId ?? null,
      ...(payload ?? {}),
    });
  };

  const connector = deps.getConnector((session.source as string) ?? "");
  if (!connector) {
    throw new Error(`No connector for source: ${session.source}`);
  }

  const sessionWindowFrom =
    typeof session.window_from === "string" ? session.window_from : undefined;
  const sessionLastImportedAt =
    typeof session.last_imported_at === "string" ? session.last_imported_at : undefined;
  const windowTo = typeof session.window_to === "string" ? session.window_to : undefined;
  const windowFrom = windowFromInput || sessionWindowFrom || sessionLastImportedAt;
  const edgeAuth = resolveEdgeAuthToken(session);
  const payerPersonId =
    typeof session.payer_person_id === "string" ? session.payer_person_id.trim() : "";
  const defaultAccountId =
    typeof session.default_account_id === "string" && session.default_account_id.trim()
      ? session.default_account_id.trim()
      : null;
  emit("parse_started", {
    source: session.source as string,
    window_from: windowFrom ?? null,
    window_to: windowTo ?? null,
    tab_id: debug?.tabId ?? null,
  });
  const parseOutput = await connector.parse({
    source: session.source as string,
    windowFrom,
    windowTo,
    session,
    debug: {
      enabled: debug?.enabled,
      parse_only: debug?.parseOnly,
      tab_id: debug?.tabId,
      debug_run_id: debug?.debugRunId,
      session_id: typeof session.session_id === "string" ? session.session_id : undefined,
      on_progress: async (update) => {
        await emitProgress(update.phase, update.progress_percent, {
          parsed_transactions_count: update.parsed_transactions_count ?? null,
        });
      },
    },
  });
  emit("parse_completed", {
    parsed_transactions_count: parseOutput.parsedTransactionsCount,
    parsed_through_at: parseOutput.parsedThroughAt,
    extraction_method: parseOutput.debug?.extraction_method ?? null,
    fallback_used: parseOutput.debug?.fallback_used ?? null,
    fallback_reason: parseOutput.debug?.fallback_reason ?? null,
  });

  await emitProgress("parse_completed", 60, {
    parsed_transactions_count: parseOutput.parsedTransactionsCount,
    parsed_through_at: parseOutput.parsedThroughAt,
    connector_debug: parseOutput.debug ?? null,
  });

  if (debug?.parseOnly) {
    emit("complete_session_started", {
      parse_only: true,
    });
    emit("complete_session_completed", {
      parse_only: true,
    });
    const parseOnlyResult = {
      batch_id: session.batch_id ?? null,
      parse_only: true,
      parse_output: parseOutput,
      debug_run_id: debug.debugRunId ?? null,
    };
    await deps.broadcastToAppTabs(
      buildProgressMessage("parse_only_completed", 100, {
        type: "MONEY_IMPORT_DONE",
        batch_id: session.batch_id ?? null,
        parse_only: true,
        debug_run_id: debug.debugRunId ?? null,
      }),
    );
    return parseOnlyResult;
  }

  const edgeTarget = resolveEdgeTarget(session.function_url);
  emit("preview_rows_started", {
    row_count: parseOutput.rows.length,
    chunk_count: chunkPreviewRows(parseOutput.rows, PREVIEW_ROWS_CHUNK_SIZE).length,
    batch_id: (session.batch_id as string) ?? null,
    session_id: (session.session_id as string) ?? null,
    payer_person_id_present: payerPersonId.length > 0,
    edge_auth_mode: edgeAuth.token_mode,
    edge_action: "preview_rows",
    edge_scheme: edgeTarget.scheme,
    edge_host: edgeTarget.host,
    edge_path: edgeTarget.path,
  });
  const previewChunks = chunkPreviewRows(parseOutput.rows, PREVIEW_ROWS_CHUNK_SIZE);
  // One id for the whole preview run. The server clears previously parsed rows only when this id
  // changes, so repeating chunk 0 — a retry, or a restarted background script — no longer throws
  // away everything the later chunks already delivered.
  const previewAttemptId = crypto.randomUUID();
  let applyResult: Record<string, unknown>;
  try {
    let previewBatchId =
      typeof session.batch_id === "string" && session.batch_id.trim() ? session.batch_id : null;
    let insertedTotal = 0;
    let skippedTotal = 0;
    let errorTotal = 0;

    for (let chunkIndex = 0; chunkIndex < previewChunks.length; chunkIndex += 1) {
      const rowsChunk = previewChunks[chunkIndex];
      const rowOffset = chunkIndex * PREVIEW_ROWS_CHUNK_SIZE;
      const isFinalChunk = chunkIndex === previewChunks.length - 1;

      await emitProgress(
        "preview_rows_started",
        resolvePreviewProgressPercent(chunkIndex, previewChunks.length),
        {
          batch_id: previewBatchId,
          chunk_index: chunkIndex,
          chunk_count: previewChunks.length,
          parsed_transactions_count: parseOutput.parsedTransactionsCount,
          parsed_through_at: parseOutput.parsedThroughAt,
        },
      );

      const chunkResult = await deps.callEdge(session.function_url as string, edgeAuth.token, {
        action: "preview_rows",
        session_id: session.session_id,
        batch_id: previewBatchId,
        payer_person_id: payerPersonId || null,
        default_account_id: defaultAccountId,
        window_from: windowFrom ?? null,
        window_to: windowTo ?? parseOutput.windowTo,
        parsed_through_at: parseOutput.parsedThroughAt,
        parsed_transactions_count: parseOutput.parsedTransactionsCount,
        chunk_index: chunkIndex,
        chunk_count: previewChunks.length,
        row_offset: rowOffset,
        is_final_chunk: isFinalChunk,
        total_row_count: parseOutput.rows.length,
        preview_attempt_id: previewAttemptId,
        rows: rowsChunk,
      });

      const chunkBatchId =
        typeof chunkResult.batch_id === "string" && chunkResult.batch_id.trim()
          ? chunkResult.batch_id
          : null;
      previewBatchId = chunkBatchId ?? previewBatchId;
      insertedTotal +=
        typeof chunkResult.inserted === "number" && Number.isFinite(chunkResult.inserted)
          ? chunkResult.inserted
          : 0;
      skippedTotal +=
        typeof chunkResult.skipped === "number" && Number.isFinite(chunkResult.skipped)
          ? chunkResult.skipped
          : 0;
      errorTotal +=
        typeof chunkResult.error_count === "number" && Number.isFinite(chunkResult.error_count)
          ? chunkResult.error_count
          : 0;
    }

    applyResult = {
      batch_id: previewBatchId ?? session.batch_id ?? null,
      inserted: insertedTotal,
      skipped: skippedTotal,
      error_count: errorTotal,
    };
  } catch (error) {
    emit("preview_rows_failed", {
      ...extractErrorDetails(error),
      edge_auth_mode: edgeAuth.token_mode,
      edge_action: "preview_rows",
      edge_scheme: edgeTarget.scheme,
      edge_host: edgeTarget.host,
      edge_path: edgeTarget.path,
    });
    throw error;
  }
  emit("preview_rows_completed", {
    batch_id: (applyResult as { batch_id?: string }).batch_id ?? session.batch_id ?? null,
    inserted:
      typeof (applyResult as { inserted?: unknown }).inserted === "number"
        ? ((applyResult as { inserted: number }).inserted ?? null)
        : null,
    skipped:
      typeof (applyResult as { skipped?: unknown }).skipped === "number"
        ? ((applyResult as { skipped: number }).skipped ?? null)
        : null,
    error_count:
      typeof (applyResult as { error_count?: unknown }).error_count === "number"
        ? ((applyResult as { error_count: number }).error_count ?? null)
        : null,
    edge_action: "preview_rows",
    edge_auth_mode: edgeAuth.token_mode,
    edge_scheme: edgeTarget.scheme,
    edge_host: edgeTarget.host,
    edge_path: edgeTarget.path,
  });

  emit("complete_session_started", {
    edge_action: "complete_session",
    edge_auth_mode: edgeAuth.token_mode,
    edge_scheme: edgeTarget.scheme,
    edge_host: edgeTarget.host,
    edge_path: edgeTarget.path,
  });
  await emitProgress("complete_session_started", 90, {
    batch_id: (applyResult as { batch_id?: string }).batch_id ?? session.batch_id ?? null,
    parsed_transactions_count: parseOutput.parsedTransactionsCount,
    parsed_through_at: parseOutput.parsedThroughAt,
  });
  try {
    await deps.callEdge(session.function_url as string, edgeAuth.token, {
      action: "complete_session",
      session_id: session.session_id,
      batch_id: (applyResult as { batch_id?: string }).batch_id ?? session.batch_id,
      status: "completed",
    });
  } catch (error) {
    emit("complete_session_failed", {
      ...extractErrorDetails(error),
      edge_action: "complete_session",
      edge_auth_mode: edgeAuth.token_mode,
      edge_scheme: edgeTarget.scheme,
      edge_host: edgeTarget.host,
      edge_path: edgeTarget.path,
    });
    throw error;
  }
  emit("complete_session_completed", {
    edge_action: "complete_session",
    edge_auth_mode: edgeAuth.token_mode,
    edge_scheme: edgeTarget.scheme,
    edge_host: edgeTarget.host,
    edge_path: edgeTarget.path,
  });

  await deps.broadcastToAppTabs(
    buildProgressMessage("review_ready", 100, {
      type: "MONEY_IMPORT_DONE",
      batch_id: (applyResult as { batch_id?: string }).batch_id ?? session.batch_id,
      debug_run_id: debug?.debugRunId ?? null,
    }),
  );

  return applyResult;
}

export async function tryCompleteSessionAsFailed(
  session: Record<string, unknown>,
  callEdge: ImportRunnerDeps["callEdge"],
): Promise<void> {
  try {
    const edgeAuth = resolveEdgeAuthToken(session);
    await callEdge(session.function_url as string, edgeAuth.token, {
      action: "complete_session",
      session_id: session.session_id,
      batch_id: session.batch_id,
      status: "failed",
    });
  } catch {
    // Ignore completion failures; original error is still reported to UI.
  }
}
