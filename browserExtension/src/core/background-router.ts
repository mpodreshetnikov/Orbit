import {
  runImportSession,
  tryCompleteSessionAsFailed,
  type ImportRunnerDebugConfig,
  type ImportRunnerDeps,
} from "./import-runner.js";
import type { ImportDebugStore } from "./import-debug.js";
import type { SessionStore } from "./session-store.js";
import { parseIncomingGrant, type GrantStore } from "./grant-store.js";
import type { AutoRunStore } from "./auto-run-store.js";
import { describeAutoRunEligibility, nextAutoRunState, shouldAutoRun } from "./auto-run-policy.js";
import type { AttentionStore } from "./attention-store.js";
import { buildAttentionStatus } from "./attention-status.js";

export interface BackgroundMessage {
  type: string;
  source_id?: unknown;
  stale_after_ms?: unknown;
  session?: Record<string, unknown>;
  grant?: unknown;
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
  grantStore: GrantStore;
  /**
   * Optional so the router stays usable without it, but when it is wired a manual run is the
   * only way back from an automatic run that has failed itself into silence.
   */
  autoRunStore?: AutoRunStore;
  importRunnerDeps: BackgroundImportRunnerDeps;
  debugStore: ImportDebugStore;
  /** The sources an unattended run can visit; what the status reports on. */
  listAutoImportSources?: () => string[];
  /** Visit-triggered sweeps waiting on their minute of quiet, by source. */
  listScheduledSweeps?: () => Promise<Array<{ sourceId: string; atMs: number }>>;
  now?: () => number;
  /** The attention page's settings and requests; without it the page gets "not available". */
  attentionStore?: AttentionStore;
  /** Where a source's bank is opened for the person, by source id. */
  resolveSourceTargetUrl?: (sourceId: string) => string | null;
  /** Opens the bank for the person -- an active tab, unlike the sweep's own. */
  openSourceTab?: (url: string) => Promise<number | null>;
}

/**
 * What the extension will do on its own, as the import page shows it. The page is the only
 * place a person can look when "nothing happens" -- and without this, nothing happening was
 * indistinguishable from a missing key, a backoff after a failure, or a sweep still waiting.
 */
export interface AutoImportStatusSource {
  source_id: string;
  last_run_at: string | null;
  last_result: "ok" | "error" | null;
  consecutive_failures: number;
  last_error: string | null;
  last_run_origin: "auto" | "manual" | null;
  next_run: { kind: "now" } | { kind: "after"; at: string } | { kind: "stopped" };
  /** A visit-triggered sweep waiting on its minute, and only one the policy will let run. */
  scheduled_at: string | null;
}

export interface BackgroundRouterContext {
  senderTabId?: number | null;
  /** The origin of the page that sent the message, as the runtime reports it. */
  senderOrigin?: string | null;
}

const activeImportRunsBySessionId = new Set<string>();
/**
 * The extension's own version, asked of the runtime rather than imported.
 *
 * This used to be `import extensionManifest from "../../manifest.json"`, and that one line
 * stopped the background service worker from starting at all. Two things were wrong with it.
 * A JSON import in a browser needs `with { type: "json" }`; without it the file is fetched and
 * parsed as JavaScript, and a manifest is not valid JavaScript, so the module threw while it
 * was being evaluated — before any statement of the background ran, which is why nothing was
 * logged and no listener was ever registered. And the path pointed outside the packaged
 * extension: from `dist/core/` it resolves to `browserExtension/manifest.json`, while the
 * extension's root is `dist/`, so the file it named was not in the package at all.
 *
 * `chrome.runtime.getManifest()` is what the platform offers for this, needs no bundler step,
 * and cannot point outside the extension.
 */
function resolveExtensionVersion(): string {
  try {
    const version = chrome?.runtime?.getManifest?.()?.version;
    return typeof version === "string" && version ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
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

async function resetAutoRunBackoff(
  deps: BackgroundRouterDeps,
  session: Record<string, unknown>,
): Promise<void> {
  if (!deps.autoRunStore) return;
  const sourceId = typeof session.source === "string" ? session.source.trim() : "";
  const payerPersonId =
    typeof session.payer_person_id === "string" ? session.payer_person_id.trim() : "";
  if (!sourceId || !payerPersonId) return;

  try {
    const scope = { sourceId, payerPersonId };
    const autoState = await deps.autoRunStore.getState(scope);
    // The backoff is cleared and the cooldown bought as by an automatic run; the origin is
    // kept so the import page does not report this as one.
    await deps.autoRunStore.setState(
      scope,
      nextAutoRunState(autoState, Date.now(), "ok", null, "manual"),
    );
  } catch {
    // Swallowed on purpose: see the call site. The worst case is that automatic import stays
    // backed off a while longer, which the next successful manual run clears.
  }
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
      extension_version: resolveExtensionVersion(),
    };
  }

  if (message.type === "MONEY_IMPORT_SET_GRANT") {
    const hostPermissions = chrome?.runtime?.getManifest?.()?.host_permissions ?? [];
    const grant = parseIncomingGrant(message.grant, hostPermissions, new Date().toISOString());
    // Refusing is the whole point of the parse: the bridge listens on window.postMessage, so
    // anything on the app's page can send one of these, and the function_url is where the token
    // would later be sent.
    if (!grant) return { ok: false, error: "Grant payload was rejected" };

    // The origin the grant names is where the extension will later open tabs -- the report,
<<<<<<< HEAD
    // the attention page. The page that sent the grant is the app, so the origin it names has
    // to be its own: one it leaves out is filled in from the sender, one that differs is the
    // page asking the extension to send the person somewhere else, and is refused.
=======
    // and whatever else comes to be opened for the person. The page that sent the grant is the
    // app, so the origin it names has to be its own: one it leaves out is filled in from the
    // sender, one that differs is the page asking the extension to send the person somewhere
    // else, and is refused.
>>>>>>> claude/last-success-and-grant-origin
    const senderOrigin = resolveAppOrigin(context?.senderOrigin);
    if (senderOrigin) {
      if (!grant.app_origin) grant.app_origin = senderOrigin;
      else if (resolveAppOrigin(grant.app_origin) !== senderOrigin) {
        return { ok: false, error: "Grant payload was rejected" };
      }
    }

    await deps.grantStore.setGrant(grant);
    return { ok: true };
  }

  if (message.type === "MONEY_IMPORT_GET_GRANT") {
    const grant = await deps.grantStore.getGrant();
    // The token is deliberately not returned. The app has no use for it -- it issued it -- and
    // a reply carrying it would put the secret back on a page it has already left.
    return {
      ok: true,
      grant: grant
        ? {
            person_id: grant.person_id,
            allowed_sources: grant.allowed_sources,
            received_at: grant.received_at,
          }
        : null,
    };
  }

  if (message.type === "MONEY_IMPORT_CLEAR_GRANT") {
    await deps.grantStore.setGrant(null);
    return { ok: true };
  }

  if (message.type === "MONEY_IMPORT_GET_AUTO_STATUS") {
    const grant = await deps.grantStore.getGrant();
    const scheduled = deps.listScheduledSweeps ? await deps.listScheduledSweeps() : [];
    const nowMs = deps.now?.() ?? Date.now();
    const sources: AutoImportStatusSource[] = [];
    if (grant && deps.autoRunStore) {
      const known = new Set(deps.listAutoImportSources?.() ?? grant.allowed_sources);
      for (const sourceId of grant.allowed_sources) {
        if (!known.has(sourceId)) continue;
        const state = await deps.autoRunStore.getState({
          sourceId,
          payerPersonId: grant.person_id,
        });
        const eligibility = describeAutoRunEligibility(state, nowMs);
        // A visit inside the cooldown still sets the alarm; when it fires the policy turns the
        // sweep away. Reporting that alarm as a run would contradict the line above it.
        const pending = scheduled.find(
          (entry) => entry.sourceId === sourceId && shouldAutoRun(state, entry.atMs),
        );
        sources.push({
          source_id: sourceId,
          last_run_at:
            state.lastRunAtMs === null ? null : new Date(state.lastRunAtMs).toISOString(),
          last_result: state.lastResult,
          consecutive_failures: state.consecutiveFailures,
          last_error: state.lastError ?? null,
          last_run_origin: state.lastRunOrigin ?? null,
          next_run:
            eligibility.kind === "after"
              ? { kind: "after", at: new Date(eligibility.atMs).toISOString() }
              : { kind: eligibility.kind },
          scheduled_at: pending ? new Date(pending.atMs).toISOString() : null,
        });
      }
    }
    // The token stays here, as with MONEY_IMPORT_GET_GRANT.
    return {
      ok: true,
      grant: grant
        ? {
            person_id: grant.person_id,
            allowed_sources: grant.allowed_sources,
            received_at: grant.received_at,
          }
        : null,
      sources,
    };
  }

  if (message.type === "MONEY_IMPORT_GET_ATTENTION") {
    if (!deps.attentionStore || !deps.autoRunStore) {
      return { ok: false, error: "Attention is not available" };
    }
    const grant = await deps.grantStore.getGrant();
    const status = await buildAttentionStatus({
      grant,
      knownSources: deps.listAutoImportSources?.() ?? grant?.allowed_sources ?? [],
      autoRunStore: deps.autoRunStore,
      attention: await deps.attentionStore.getState(),
      nowMs: deps.now?.() ?? Date.now(),
    });
    // The token stays here, as with MONEY_IMPORT_GET_GRANT.
    return {
      ok: true,
      grant: grant
        ? {
            person_id: grant.person_id,
            allowed_sources: grant.allowed_sources,
            received_at: grant.received_at,
          }
        : null,
      ...status,
    };
  }

  if (message.type === "MONEY_IMPORT_REQUEST_RUN") {
    // The person has been told a source is stale and pressed Update: the bank opens for them
    // to sign in, and the visit that follows runs the import whatever the backoff says. The
    // attempt history is left alone -- nothing has succeeded yet; the run will say.
    if (!deps.attentionStore) return { ok: false, error: "Attention is not available" };
    const grant = await deps.grantStore.getGrant();
    if (!grant) return { ok: false, error: "No import grant" };
    const sourceId = toTrimmedString(message.source_id);
    if (!sourceId || !grant.allowed_sources.includes(sourceId)) {
      return { ok: false, error: "Source is not covered by the grant" };
    }
    const targetUrl = deps.resolveSourceTargetUrl?.(sourceId) ?? null;
    if (!targetUrl) return { ok: false, error: "Source has no page to open" };
    await deps.attentionStore.requestRun(sourceId, deps.now?.() ?? Date.now());
    const tabId = deps.openSourceTab ? await deps.openSourceTab(targetUrl) : null;
    return { ok: true, source_id: sourceId, target_url: targetUrl, tab_id: tabId };
  }

  if (message.type === "MONEY_IMPORT_SET_ATTENTION_SETTINGS") {
    if (!deps.attentionStore) return { ok: false, error: "Attention is not available" };
    const staleAfterMs = await deps.attentionStore.setStaleAfterMs(message.stale_after_ms);
    return { ok: true, stale_after_ms: staleAfterMs };
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
      // A run the person started is the documented way out of the automatic backoff: after
      // enough consecutive failures `shouldAutoRun` stops trying entirely, and without this
      // nothing ever cleared that count -- so a fortnight signed out of the bank would have
      // ended automatic import permanently, with no way back short of reinstalling.
      //
      // Best-effort, and deliberately so. The import above has already completed its session on
      // the server; letting a storage failure here fall into the catch below would mark that
      // finished session failed, clear it, and tell the person their successful import errored.
      // Local bookkeeping does not get to fail a transaction that has already committed.
      await resetAutoRunBackoff(deps, session);

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
