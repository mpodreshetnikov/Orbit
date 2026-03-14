import {
  runImportSession,
  tryCompleteSessionAsFailed,
  type ImportRunnerDebugConfig,
  type ImportRunnerDeps,
} from "./import-runner.js";
import type { ImportDebugStore } from "./import-debug.js";
import type { SessionStore } from "./session-store.js";
import extensionManifest from "../../manifest.json";

export interface BackgroundMessage {
  type: string;
  session?: Record<string, unknown>;
  session_id?: string;
  source?: string;
  payer_person_id?: string;
  candidates?: Array<Record<string, unknown>>;
  phase?: string;
  progress_percent?: number;
  parsed_transactions_count?: number;
  estimated_total_ms?: number;
  estimated_remaining_ms?: number;
  estimated_receipt_request_count?: number;
  estimate_updated_at?: string;
  batch_id?: string;
  windowFrom?: string;
  origin?: "source_page_overlay" | "popup" | "automation";
  debug?: {
    enabled?: boolean;
    parse_only?: boolean;
    tab_id?: number;
    debug_run_id?: string;
  };
}

type BackgroundImportRunnerDeps = ImportRunnerDeps & {
  broadcastToSourceTab?: (tabId: number, message: Record<string, unknown>) => Promise<void>;
};

export interface BackgroundRouterDeps {
  sessionStore: SessionStore;
  importRunnerDeps: BackgroundImportRunnerDeps;
  debugStore: ImportDebugStore;
}

export interface BackgroundRouterContext {
  senderTabId?: number | null;
}

const activeImportRunsBySessionId = new Set<string>();
const EXTENSION_VERSION =
  typeof extensionManifest.version === "string" ? extensionManifest.version : "0.0.0";
type ActiveImportRunSnapshot = {
  running: boolean;
  phase: string | null;
  progress_percent: number;
  parsed_transactions_count: number | null;
  estimated_total_ms: number | null;
  estimated_remaining_ms: number | null;
  estimated_receipt_request_count: number | null;
  estimate_updated_at: string | null;
  batch_id: string | null;
  error: string | null;
};

const activeImportRunStateBySessionId = new Map<string, ActiveImportRunSnapshot>();

function resolveFunctionTarget(functionUrl: unknown): {
  function_url_present: boolean;
  function_url_valid: boolean;
  function_scheme: string | null;
  function_host: string | null;
  function_path: string | null;
} {
  if (typeof functionUrl !== "string" || !functionUrl.trim()) {
    return {
      function_url_present: false,
      function_url_valid: false,
      function_scheme: null,
      function_host: null,
      function_path: null,
    };
  }
  try {
    const parsed = new URL(functionUrl);
    return {
      function_url_present: true,
      function_url_valid: true,
      function_scheme: parsed.protocol.replace(":", ""),
      function_host: parsed.host,
      function_path: parsed.pathname,
    };
  } catch {
    return {
      function_url_present: true,
      function_url_valid: false,
      function_scheme: null,
      function_host: null,
      function_path: null,
    };
  }
}

function extractErrorDiagnostics(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as Record<string, unknown>;
  const code = typeof candidate.code === "string" ? candidate.code : null;
  const action = typeof candidate.action === "string" ? candidate.action : null;
  const functionHost = typeof candidate.function_host === "string" ? candidate.function_host : null;
  const functionPath = typeof candidate.function_path === "string" ? candidate.function_path : null;
  const httpStatus =
    typeof candidate.http_status === "number" && Number.isFinite(candidate.http_status)
      ? candidate.http_status
      : null;
  const responseError =
    typeof candidate.response_error === "string" ? candidate.response_error : null;
  const transport = typeof candidate.transport === "string" ? candidate.transport : null;

  if (!code && !action && !functionHost && !httpStatus && !responseError && !transport) {
    return null;
  }
  return {
    error_code: code,
    edge_action: action,
    edge_host: functionHost,
    edge_path: functionPath,
    edge_http_status: httpStatus,
    edge_response_error: responseError,
    edge_transport: transport,
  };
}

function resolveSenderTabId(context: BackgroundRouterContext | undefined): number | null {
  if (!context) return null;
  return typeof context.senderTabId === "number" && Number.isFinite(context.senderTabId)
    ? context.senderTabId
    : null;
}

function resolveBatchId(
  result: Record<string, unknown>,
  session: Record<string, unknown>,
): string | null {
  const fromResult = typeof result.batch_id === "string" ? result.batch_id.trim() : "";
  if (fromResult) return fromResult;
  const fromSession = typeof session.batch_id === "string" ? session.batch_id.trim() : "";
  return fromSession || null;
}

function resolveAppOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function buildReportUrl(appOrigin: string, batchId: string): string {
  const reportUrl = new URL(`/money/import/reports/${batchId}`, appOrigin);
  return reportUrl.toString();
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveRuntimeExtensionId(): string | null {
  const runtimeId = toTrimmedString(chrome.runtime.id);
  if (runtimeId) return runtimeId;

  try {
    const runtimeUrl = toTrimmedString(chrome.runtime.getURL(""));
    if (!runtimeUrl) return null;
    const parsed = new URL(runtimeUrl);
    return parsed.protocol === "chrome-extension:" ? toTrimmedString(parsed.host) : null;
  } catch {
    return null;
  }
}

function resolveEdgeAuthToken(session: Record<string, unknown>): string | null {
  const userToken =
    typeof session.user_access_token === "string" ? session.user_access_token.trim() : "";
  if (userToken) return userToken;
  const sessionToken =
    typeof session.session_token === "string" ? session.session_token.trim() : "";
  return sessionToken || null;
}

function buildActiveRunSnapshot(
  payload: Record<string, unknown>,
  current?: ActiveImportRunSnapshot,
): ActiveImportRunSnapshot {
  return {
    running: typeof payload.running === "boolean" ? payload.running : (current?.running ?? false),
    phase: toTrimmedString(payload.phase) ?? current?.phase ?? null,
    progress_percent:
      typeof payload.progress_percent === "number" && Number.isFinite(payload.progress_percent)
        ? payload.progress_percent
        : (current?.progress_percent ?? 0),
    parsed_transactions_count:
      typeof payload.parsed_transactions_count === "number" &&
      Number.isFinite(payload.parsed_transactions_count)
        ? payload.parsed_transactions_count
        : (current?.parsed_transactions_count ?? null),
    estimated_total_ms:
      typeof payload.estimated_total_ms === "number" && Number.isFinite(payload.estimated_total_ms)
        ? payload.estimated_total_ms
        : (current?.estimated_total_ms ?? null),
    estimated_remaining_ms:
      typeof payload.estimated_remaining_ms === "number" &&
      Number.isFinite(payload.estimated_remaining_ms)
        ? payload.estimated_remaining_ms
        : (current?.estimated_remaining_ms ?? null),
    estimated_receipt_request_count:
      typeof payload.estimated_receipt_request_count === "number" &&
      Number.isFinite(payload.estimated_receipt_request_count)
        ? payload.estimated_receipt_request_count
        : (current?.estimated_receipt_request_count ?? null),
    estimate_updated_at:
      toTrimmedString(payload.estimate_updated_at) ?? current?.estimate_updated_at ?? null,
    batch_id: toTrimmedString(payload.batch_id) ?? current?.batch_id ?? null,
    error: toTrimmedString(payload.error) ?? current?.error ?? null,
  };
}

export async function routeBackgroundMessage(
  message: BackgroundMessage,
  deps: BackgroundRouterDeps,
  context?: BackgroundRouterContext,
): Promise<Record<string, unknown>> {
  if (message.type === "MONEY_IMPORT_PING") {
    return {
      ok: true,
      extension_id: resolveRuntimeExtensionId(),
      extension_version: EXTENSION_VERSION,
    };
  }

  if (message.type === "MONEY_IMPORT_START_SESSION") {
    await deps.sessionStore.setSession(message.session ?? null);
    return { ok: true };
  }

  if (message.type === "MONEY_IMPORT_GET_SESSION") {
    const session = await deps.sessionStore.getSession();
    const sessionId = toTrimmedString(session?.session_id);
    return {
      ok: true,
      session,
      active_run: sessionId ? (activeImportRunStateBySessionId.get(sessionId) ?? null) : null,
    };
  }

  if (message.type === "MONEY_IMPORT_PROGRESS") {
    const payload: Record<string, unknown> = {
      type: "MONEY_IMPORT_PROGRESS",
    };
    if (typeof message.phase === "string") payload.phase = message.phase;
    if (typeof message.progress_percent === "number") {
      payload.progress_percent = message.progress_percent;
    }
    if (typeof message.parsed_transactions_count === "number") {
      payload.parsed_transactions_count = message.parsed_transactions_count;
    }
    if (typeof message.estimated_total_ms === "number") {
      payload.estimated_total_ms = message.estimated_total_ms;
    }
    if (typeof message.estimated_remaining_ms === "number") {
      payload.estimated_remaining_ms = message.estimated_remaining_ms;
    }
    if (typeof message.estimated_receipt_request_count === "number") {
      payload.estimated_receipt_request_count = message.estimated_receipt_request_count;
    }
    if (typeof message.estimate_updated_at === "string") {
      payload.estimate_updated_at = message.estimate_updated_at;
    }
    if (typeof message.batch_id === "string") payload.batch_id = message.batch_id;

    const sessionId = toTrimmedString(message.session_id);
    if (sessionId) {
      activeImportRunStateBySessionId.set(
        sessionId,
        buildActiveRunSnapshot(
          {
            ...payload,
            running: true,
          },
          activeImportRunStateBySessionId.get(sessionId),
        ),
      );
    }

    await deps.importRunnerDeps.broadcastToAppTabs(payload);
    const senderTabId = resolveSenderTabId(context);
    if (senderTabId !== null && deps.importRunnerDeps.broadcastToSourceTab) {
      await deps.importRunnerDeps.broadcastToSourceTab(senderTabId, payload).catch(() => undefined);
    }

    return { ok: true };
  }

  if (message.type === "MONEY_IMPORT_GET_EXISTING_TRANSACTION_STATES") {
    const session = await deps.sessionStore.getSession();
    if (!session) {
      throw new Error("No active import session");
    }
    const functionUrl = toTrimmedString(session.function_url);
    const authToken = resolveEdgeAuthToken(session);
    const source = toTrimmedString(message.source) ?? toTrimmedString(session.source);
    const payerPersonId =
      toTrimmedString(message.payer_person_id) ?? toTrimmedString(session.payer_person_id);
    const candidates = Array.isArray(message.candidates) ? message.candidates : [];

    if (!functionUrl || !authToken || !source || !payerPersonId) {
      return { ok: true, states: [] };
    }

    const response = await deps.importRunnerDeps.callEdge(functionUrl, authToken, {
      action: "get_existing_transaction_states",
      source,
      payer_person_id: payerPersonId,
      candidates,
    });
    return {
      ok: true,
      states: Array.isArray(response.states) ? response.states : [],
    };
  }

  if (message.type === "MONEY_IMPORT_RUN") {
    const session = await deps.sessionStore.getSession();
    if (!session) {
      throw new Error("No active import session");
    }
    const activeSessionId = typeof session.session_id === "string" ? session.session_id.trim() : "";
    if (activeSessionId && activeImportRunsBySessionId.has(activeSessionId)) {
      throw new Error(`Import already running for session ${activeSessionId}`);
    }
    if (activeSessionId) {
      activeImportRunsBySessionId.add(activeSessionId);
      activeImportRunStateBySessionId.set(
        activeSessionId,
        buildActiveRunSnapshot({
          running: true,
          phase: "starting",
          progress_percent: 2,
          parsed_transactions_count: null,
          estimated_total_ms: null,
          estimated_remaining_ms: null,
          estimated_receipt_request_count: null,
          estimate_updated_at: null,
          batch_id: session.batch_id,
          error: null,
        }),
      );
    }
    const senderTabId = resolveSenderTabId(context);
    const shouldBroadcastToSourceTab =
      message.origin === "source_page_overlay" && senderTabId !== null;

    const broadcastToRelevantTabs = async (payload: Record<string, unknown>) => {
      if (activeSessionId) {
        activeImportRunStateBySessionId.set(
          activeSessionId,
          buildActiveRunSnapshot(
            {
              ...payload,
              running:
                payload.type === "MONEY_IMPORT_ERROR"
                  ? false
                  : payload.type === "MONEY_IMPORT_DONE"
                    ? false
                    : true,
            },
            activeImportRunStateBySessionId.get(activeSessionId),
          ),
        );
      }
      await deps.importRunnerDeps.broadcastToAppTabs(payload);
      if (!shouldBroadcastToSourceTab || !deps.importRunnerDeps.broadcastToSourceTab) {
        return;
      }
      await deps.importRunnerDeps.broadcastToSourceTab(senderTabId, payload).catch(() => undefined);
    };

    const debugEnabled = Boolean(message.debug?.enabled);
    const run = debugEnabled
      ? deps.debugStore.startRun({
          debug_run_id: message.debug?.debug_run_id,
          session_id: (session.session_id as string) ?? null,
          batch_id: (session.batch_id as string) ?? null,
          source: (session.source as string) ?? null,
          tab_id: message.debug?.tab_id ?? null,
          window_from:
            message.windowFrom ??
            (session.window_from as string) ??
            (session.last_imported_at as string) ??
            null,
        })
      : null;

    const emitDebug = (event: string, attrs?: Record<string, unknown>) => {
      if (!run) return;
      deps.debugStore.append(run.debug_run_id, { event, attrs });
    };

    if (run) {
      const functionTarget = resolveFunctionTarget(session.function_url);
      emitDebug("session_loaded", {
        has_session_id: Boolean(session.session_id),
        has_batch_id: Boolean(session.batch_id),
        has_session_token: Boolean(session.session_token),
        has_user_access_token: Boolean(session.user_access_token),
        has_payer_person_id: Boolean(session.payer_person_id),
        ...functionTarget,
      });
      emitDebug("connector_resolved", {
        source: (session.source as string) ?? null,
      });
      await broadcastToRelevantTabs({
        type: "MONEY_IMPORT_DEBUG_STATUS",
        phase: "started",
        debug_run_id: run.debug_run_id,
      });
    }

    try {
      const runDeps: ImportRunnerDeps = {
        ...deps.importRunnerDeps,
        broadcastToAppTabs: broadcastToRelevantTabs,
      };
      const runnerDebug: ImportRunnerDebugConfig = {
        enabled: debugEnabled,
        parseOnly: Boolean(message.debug?.parse_only),
        tabId: message.debug?.tab_id,
        debugRunId: run?.debug_run_id,
        emit: emitDebug,
      };
      const result = await runImportSession(session, message.windowFrom, runDeps, runnerDebug);
      if (run) {
        deps.debugStore.finish(run.debug_run_id, "ok");
        await broadcastToRelevantTabs({
          type: "MONEY_IMPORT_DEBUG_STATUS",
          phase: "completed",
          debug_run_id: run.debug_run_id,
        });
      }
      const response: Record<string, unknown> = {
        ok: true,
        result,
        debug_run_id: run?.debug_run_id ?? null,
      };
      if (message.origin === "source_page_overlay") {
        const appOrigin = resolveAppOrigin(session.app_origin);
        const batchId = resolveBatchId(result, session);
        if (appOrigin && batchId) {
          response.report_url = buildReportUrl(appOrigin, batchId);
        }
      }
      await deps.sessionStore.setSession(null);
      return response;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown import error";
      const diagnostics = extractErrorDiagnostics(error);
      if (!message.debug?.parse_only) {
        await tryCompleteSessionAsFailed(session, deps.importRunnerDeps.callEdge);
      }
      await deps.sessionStore.setSession(null);
      if (run) {
        emitDebug("run_failed", {
          error_message: messageText,
          ...(diagnostics ?? {}),
        });
        deps.debugStore.finish(run.debug_run_id, "error", messageText);
        await broadcastToRelevantTabs({
          type: "MONEY_IMPORT_DEBUG_STATUS",
          phase: "failed",
          debug_run_id: run.debug_run_id,
          error: messageText,
          diagnostics,
        });
      }
      throw error;
    } finally {
      if (activeSessionId) {
        activeImportRunsBySessionId.delete(activeSessionId);
        activeImportRunStateBySessionId.delete(activeSessionId);
      }
    }
  }

  if (message.type === "MONEY_IMPORT_DEBUG_GET_LAST_RUN") {
    return {
      ok: true,
      run: deps.debugStore.getLastRunSummary(),
    };
  }

  if (message.type === "MONEY_IMPORT_DEBUG_CLEAR_RUNS") {
    deps.debugStore.clearRuns();
    return { ok: true };
  }

  if (
    message.type === "MONEY_IMPORT_DEBUG_EXPORT_LAST_RUN" ||
    message.type === "MONEY_IMPORT_DEBUG_EXPORT_RUN"
  ) {
    const run = deps.debugStore.getLastRunSummary();
    if (!run) {
      return { ok: false, error: "No debug run available for export." };
    }
    return {
      ok: true,
      bundle: {
        exported_at: new Date().toISOString(),
        run,
      },
    };
  }

  return { ok: false, error: "Unsupported message type" };
}
