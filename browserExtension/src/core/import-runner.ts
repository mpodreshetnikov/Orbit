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

type ProgressPhase = "parse_completed" | "parse_only_completed" | "completed";

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

  const connector = deps.getConnector((session.source as string) ?? "");
  if (!connector) {
    throw new Error(`No connector for source: ${session.source}`);
  }

  const sessionLastImportedAt =
    typeof session.last_imported_at === "string" ? session.last_imported_at : undefined;
  const windowFrom = windowFromInput || sessionLastImportedAt;
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
    tab_id: debug?.tabId ?? null,
  });
  const parseOutput = await connector.parse({
    source: session.source as string,
    windowFrom,
    session,
    debug: {
      enabled: debug?.enabled,
      parse_only: debug?.parseOnly,
      tab_id: debug?.tabId,
      debug_run_id: debug?.debugRunId,
    },
  });
  emit("parse_completed", {
    parsed_transactions_count: parseOutput.parsedTransactionsCount,
    parsed_through_at: parseOutput.parsedThroughAt,
    extraction_method: parseOutput.debug?.extraction_method ?? null,
    fallback_used: parseOutput.debug?.fallback_used ?? null,
    fallback_reason: parseOutput.debug?.fallback_reason ?? null,
  });

  await deps.broadcastToAppTabs({
    type: "MONEY_IMPORT_PROGRESS",
    parsed_transactions_count: parseOutput.parsedTransactionsCount,
    parsed_through_at: parseOutput.parsedThroughAt,
    debug_run_id: debug?.debugRunId ?? null,
    connector_debug: parseOutput.debug ?? null,
    phase: "parse_completed",
    progress_percent: 40,
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
    batch_id: (session.batch_id as string) ?? null,
    session_id: (session.session_id as string) ?? null,
    payer_person_id_present: payerPersonId.length > 0,
    edge_auth_mode: edgeAuth.token_mode,
    edge_action: "preview_rows",
    edge_scheme: edgeTarget.scheme,
    edge_host: edgeTarget.host,
    edge_path: edgeTarget.path,
  });
  let applyResult: Record<string, unknown>;
  try {
    applyResult = await deps.callEdge(session.function_url as string, edgeAuth.token, {
      action: "preview_rows",
      session_id: session.session_id,
      batch_id: session.batch_id,
      payer_person_id: payerPersonId || null,
      default_account_id: defaultAccountId,
      window_from: windowFrom ?? null,
      window_to: parseOutput.windowTo,
      parsed_through_at: parseOutput.parsedThroughAt,
      parsed_transactions_count: parseOutput.parsedTransactionsCount,
      rows: parseOutput.rows,
    });
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
  try {
    await deps.callEdge(session.function_url as string, edgeAuth.token, {
      action: "complete_session",
      session_id: session.session_id,
      batch_id: session.batch_id,
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
    buildProgressMessage("completed", 100, {
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
