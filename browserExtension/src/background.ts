import "./connectors/tbank-web.js";
import "./connectors/alfa-web.js";
import { getConnector } from "./connectors/registry.js";
import { APP_ORIGIN_PATTERNS, DEV_HOT_RELOAD } from "./env.js";
import { routeBackgroundMessage, type BackgroundMessage } from "./core/background-router.js";
import { createImportDebugStore } from "./core/import-debug.js";
import { createExtensionLogger } from "./core/observability.js";
import { createSessionStore } from "./core/session-store.js";
import { createGrantStore } from "./core/grant-store.js";
import { createBackfillStore } from "./core/backfill-store.js";
import { createAutoRunStore } from "./core/auto-run-store.js";
import { nextAutoRunState, pickAutoRunTab, shouldAutoRun } from "./core/auto-run-policy.js";
import { runScheduledImport } from "./core/import-runner.js";
import {
  getAllMoneyImportSourcePagePatterns,
  getMoneyImportSourcePagePatterns,
  listMoneyImportSourceDefinitions,
  matchesKnownMoneyImportSourcePageUrl,
  matchesMoneyImportSourcePageUrl,
  shouldShowMoneyImportSourcePageWidget,
} from "./money-import-sources.js";

async function broadcastToAppTabs(message: Record<string, unknown>): Promise<void> {
  if (!Array.isArray(APP_ORIGIN_PATTERNS) || APP_ORIGIN_PATTERNS.length === 0) {
    return;
  }

  const tabs = await chrome.tabs.query({
    url: APP_ORIGIN_PATTERNS,
  });

  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id!, message).catch(() => null)));
}

async function broadcastToSourceTab(
  tabId: number,
  message: Record<string, unknown>,
): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

function resolveSourceId(session: Record<string, unknown> | null): string | null {
  if (!session) return null;
  return typeof session.source === "string" ? session.source : null;
}

function resolveSourcePagePatterns(sourceId: string | null): string[] {
  return getMoneyImportSourcePagePatterns(sourceId);
}

async function injectSourcePageWidget(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["source-page-widget.inpage.js"],
  });
}

async function sendSessionToSourcePageTab(
  tabId: number,
  session: Record<string, unknown> | null,
): Promise<void> {
  await broadcastToSourceTab(tabId, {
    type: "MONEY_IMPORT_SESSION_UPDATED",
    session,
  });
}

async function syncSourcePageWidgetForSession(
  session: Record<string, unknown> | null,
  opts?: { tabId?: number; tabUrl?: string },
): Promise<void> {
  const sourceId = resolveSourceId(session);
  const showWidget = shouldShowMoneyImportSourcePageWidget(session);

  if (typeof opts?.tabId === "number") {
    if (!matchesKnownMoneyImportSourcePageUrl(opts.tabUrl)) return;
    if (showWidget && sourceId) {
      await injectSourcePageWidget(opts.tabId).catch(() => undefined);
      await sendSessionToSourcePageTab(opts.tabId, session).catch(() => undefined);
      return;
    }
    await sendSessionToSourcePageTab(opts.tabId, null).catch(() => undefined);
    return;
  }

  const patterns = showWidget
    ? resolveSourcePagePatterns(sourceId)
    : getAllMoneyImportSourcePagePatterns();
  if (patterns.length === 0) return;

  const tabs = await chrome.tabs.query({ url: patterns });
  const tasks: Array<Promise<unknown>> = [];
  tabs.forEach((tab) => {
    if (typeof tab.id !== "number") return;
    if (showWidget) {
      tasks.push(injectSourcePageWidget(tab.id).catch(() => undefined));
      tasks.push(sendSessionToSourcePageTab(tab.id, session).catch(() => undefined));
      return;
    }
    tasks.push(sendSessionToSourcePageTab(tab.id, null).catch(() => undefined));
  });
  await Promise.all(tasks);
}

async function maybeOpenReportTab(reportUrl: unknown): Promise<void> {
  if (typeof reportUrl !== "string" || !reportUrl.trim()) return;
  await chrome.tabs.create({ url: reportUrl, active: true });
}

let devBuildId: string | null = null;

async function checkDevHotReload(): Promise<void> {
  try {
    const response = await fetch(`${chrome.runtime.getURL("reload-trigger.json")}?_=${Date.now()}`);
    if (!response.ok) return;

    const payload = (await response.json()) as { buildId?: string };
    const nextBuildId = payload && typeof payload.buildId === "string" ? payload.buildId : null;
    if (!nextBuildId) return;

    if (devBuildId === null) {
      devBuildId = nextBuildId;
      return;
    }

    if (nextBuildId !== devBuildId) {
      devBuildId = nextBuildId;
      chrome.runtime.reload();
    }
  } catch {
    // Ignore dev reload polling failures.
  }
}

function startDevHotReloadWatcher(): void {
  void checkDevHotReload();
  setInterval(() => {
    void checkDevHotReload();
  }, 1000);
}

if (DEV_HOT_RELOAD) {
  startDevHotReloadWatcher();
}

async function callEdge(
  functionUrl: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payloadBatchId = typeof payload.batch_id === "string" ? payload.batch_id.trim() : "";
  const payloadSessionId = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
  const payloadRowCount = Array.isArray(payload.rows) ? payload.rows.length : null;
  const payerPersonIdPresent =
    typeof payload.payer_person_id === "string" && payload.payer_person_id.trim().length > 0;
  const action = typeof payload.action === "string" ? payload.action : "unknown";
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(functionUrl);
  } catch {
    throw Object.assign(new Error(`Invalid function_url for edge call (${action})`), {
      code: "EDGE_INVALID_URL",
      action,
      function_host: null,
      function_path: null,
      http_status: null,
      response_error: null,
      transport: "config",
    });
  }

  telemetry.info("money_import_edge_request_started", {
    edge_action: action,
    edge_host: parsedUrl.host,
    edge_path: parsedUrl.pathname,
    edge_scheme: parsedUrl.protocol.replace(":", ""),
    has_token: typeof token === "string" && token.length > 0,
    batch_id: payloadBatchId || null,
    session_id: payloadSessionId || null,
    row_count: payloadRowCount,
    payer_person_id_present: payerPersonIdPresent,
  });

  let response: Response;
  try {
    response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    telemetry.error("money_import_edge_request_failed", {
      edge_action: action,
      edge_host: parsedUrl.host,
      edge_path: parsedUrl.pathname,
      edge_transport: "network",
      edge_http_status: null,
      error_name: error instanceof Error ? error.name : null,
      error_message: error instanceof Error ? error.message : "Failed to fetch",
    });
    throw Object.assign(new Error(`Edge fetch failed (${action}): Failed to fetch`), {
      code: "EDGE_FETCH_FAILED",
      action,
      function_host: parsedUrl.host,
      function_path: parsedUrl.pathname,
      http_status: null,
      response_error: error instanceof Error ? error.message : null,
      transport: "network",
    });
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string;
  };
  if (!response.ok) {
    const responseError =
      typeof data.error === "string" && data.error.trim().length > 0 ? data.error : null;
    telemetry.error("money_import_edge_request_failed", {
      edge_action: action,
      edge_host: parsedUrl.host,
      edge_path: parsedUrl.pathname,
      edge_transport: "http",
      edge_http_status: response.status,
      error_message: responseError ?? "Money import edge request failed",
    });
    throw Object.assign(
      new Error(
        responseError
          ? `Edge request failed (${action}) status ${response.status}: ${responseError}`
          : `Edge request failed (${action}) status ${response.status}`,
      ),
      {
        code: "EDGE_HTTP_ERROR",
        action,
        function_host: parsedUrl.host,
        function_path: parsedUrl.pathname,
        http_status: response.status,
        response_error: responseError,
        transport: "http",
      },
    );
  }
  telemetry.info("money_import_edge_request_completed", {
    edge_action: action,
    edge_host: parsedUrl.host,
    edge_path: parsedUrl.pathname,
    edge_http_status: response.status,
    batch_id: (typeof data.batch_id === "string" && data.batch_id.trim()) || payloadBatchId || null,
    session_id: payloadSessionId || null,
    row_count: payloadRowCount,
    payer_person_id_present: payerPersonIdPresent,
    inserted:
      ["apply_rows", "preview_rows", "apply_batch"].includes(action) &&
      typeof data.inserted === "number" &&
      Number.isFinite(data.inserted)
        ? data.inserted
        : null,
    skipped:
      ["apply_rows", "preview_rows", "apply_batch"].includes(action) &&
      typeof data.skipped === "number" &&
      Number.isFinite(data.skipped)
        ? data.skipped
        : null,
    error_count:
      ["apply_rows", "preview_rows", "apply_batch"].includes(action) &&
      typeof data.error_count === "number" &&
      Number.isFinite(data.error_count)
        ? data.error_count
        : null,
  });
  return data;
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
    code,
    action,
    function_host: functionHost,
    function_path: functionPath,
    http_status: httpStatus,
    response_error: responseError,
    transport,
  };
}

const sessionStore = createSessionStore(chrome.storage.local);
const grantStore = createGrantStore(chrome.storage.local);
const backfillStore = createBackfillStore(chrome.storage.local);
const autoRunStore = createAutoRunStore(chrome.storage.local);
const debugStore = createImportDebugStore();
const telemetry = createExtensionLogger("background");
telemetry.info("extension_background_initialized", {
  dev_hot_reload: DEV_HOT_RELOAD,
  app_origin_pattern_count: Array.isArray(APP_ORIGIN_PATTERNS) ? APP_ORIGIN_PATTERNS.length : 0,
});

/**
 * Starts an import when the person visits their bank for their own reasons.
 *
 * This is what removes the need to remember: the visit that was going to happen anyway is
 * also the moment the extension has a live authorised page to work from, which is the one
 * thing it cannot get on its own.
 */
async function maybeAutoRunOnSourcePage(tabUrl: string, tabId: number): Promise<void> {
  const grant = await grantStore.getGrant();
  if (!grant) return;

  const definition = listMoneyImportSourceDefinitions().find((source) =>
    matchesMoneyImportSourcePageUrl(source.sourceId, tabUrl),
  );
  if (!definition) return;
  if (grant.allowedSources.length > 0 && !grant.allowedSources.includes(definition.sourceId)) {
    return;
  }
  if (!grant.functionUrl) return;

  // A manual run already in flight owns the tab; two runs racing over one bank page would
  // only produce rate-limit errors for both.
  const activeSession = await sessionStore.getSession();
  if (activeSession) return;

  const nowMs = Date.now();
  const state = await autoRunStore.getState(definition.sourceId);
  if (!shouldAutoRun(state, nowMs)) return;

  try {
    await runScheduledImport(
      {
        sourceId: definition.sourceId,
        payerPersonId: grant.personId,
        nowMs,
        functionUrl: grant.functionUrl,
        credentials: { grantToken: grant.token },
        appOrigin: grant.appOrigin,
        showSourcePageWidget: true,
        // The tab whose navigation triggered this run is the one to work in; it is not
        // necessarily the active tab of the last focused window.
        tabId,
      },
      {
        getConnector,
        callEdge,
        broadcastToAppTabs,
        nowIso: () => new Date().toISOString(),
        backfillStore,
        sessionStore,
      },
    );
    await autoRunStore.setState(definition.sourceId, nextAutoRunState(state, nowMs, "ok"));
  } catch (error) {
    // A signed-out bank page is the ordinary failure here, not an emergency: record it so
    // the backoff widens, and say nothing to the user.
    telemetry.warn("money_import_auto_run_failed", {
      source_id: definition.sourceId,
      error_message: error instanceof Error ? error.message : String(error),
    });
    await autoRunStore.setState(definition.sourceId, nextAutoRunState(state, nowMs, "error"));
  } finally {
    await sessionStore.setSession(null);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const nextUrl = typeof changeInfo.url === "string" ? changeInfo.url : tab.url;
  if (!nextUrl) return;
  const isComplete = changeInfo.status === "complete";
  const hasNavigated = typeof changeInfo.url === "string";
  if (!isComplete && !hasNavigated) return;

  void (async () => {
    const session = await sessionStore.getSession();
    if (!session) {
      if (isComplete && matchesKnownMoneyImportSourcePageUrl(nextUrl)) {
        await maybeAutoRunOnSourcePage(nextUrl, tabId);
      }
      return;
    }
    await syncSourcePageWidgetForSession(session, { tabId, tabUrl: nextUrl });
  })();
});

const DAILY_IMPORT_ALARM = "money-import-daily";
const DAILY_IMPORT_ALARM_PERIOD_MINUTES = 180;
/** A visit-triggered run covers the day; the alarm exists for the days without a visit. */
const DAILY_IMPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const BACKGROUND_TAB_LOAD_TIMEOUT_MS = 30_000;

async function waitForTabComplete(tabId: number): Promise<boolean> {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < BACKGROUND_TAB_LOAD_TIMEOUT_MS) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === "complete") return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * The fallback for someone who has not opened their bank in days.
 *
 * The connector needs a live authorised bank page, and there is no way around that — so when
 * no such tab is open, one is opened in the background, used, and closed again. Only a tab
 * this function opened is ever closed; a tab the person had open is left exactly as it was.
 */
async function runDailyImportSweep(): Promise<void> {
  const grant = await grantStore.getGrant();
  if (!grant?.functionUrl) return;

  const activeSession = await sessionStore.getSession();
  if (activeSession) return;

  for (const definition of listMoneyImportSourceDefinitions()) {
    if (grant.allowedSources.length > 0 && !grant.allowedSources.includes(definition.sourceId)) {
      continue;
    }

    const nowMs = Date.now();
    const state = await autoRunStore.getState(definition.sourceId);
    if (!shouldAutoRun(state, nowMs, { cooldownMs: DAILY_IMPORT_COOLDOWN_MS })) continue;

    const patterns = getMoneyImportSourcePagePatterns(definition.sourceId);
    const openTabs = patterns.length > 0 ? await chrome.tabs.query({ url: patterns }) : [];
    const existingTab = pickAutoRunTab(openTabs, (url) =>
      matchesMoneyImportSourcePageUrl(definition.sourceId, url),
    );

    let openedTabId: number | null = null;
    if (!existingTab) {
      if (!definition.targetUrl) continue;
      const created = await chrome.tabs.create({ url: definition.targetUrl, active: false });
      if (typeof created.id !== "number") continue;
      openedTabId = created.id;
      const loaded = await waitForTabComplete(openedTabId);
      if (!loaded) {
        await chrome.tabs.remove(openedTabId).catch(() => {});
        await autoRunStore.setState(definition.sourceId, nextAutoRunState(state, nowMs, "error"));
        continue;
      }
    }

    // Whether the tab was found or opened, it is a background tab: the connector must be
    // told which one, or it looks at the active tab instead and rejects it.
    const targetTabId = openedTabId ?? existingTab?.id ?? null;
    if (typeof targetTabId !== "number") continue;

    try {
      await runScheduledImport(
        {
          sourceId: definition.sourceId,
          payerPersonId: grant.personId,
          nowMs,
          functionUrl: grant.functionUrl,
          credentials: { grantToken: grant.token },
          appOrigin: grant.appOrigin,
          showSourcePageWidget: existingTab !== null,
          tabId: targetTabId,
        },
        {
          getConnector,
          callEdge,
          broadcastToAppTabs,
          nowIso: () => new Date().toISOString(),
          backfillStore,
          sessionStore,
        },
      );
      await autoRunStore.setState(definition.sourceId, nextAutoRunState(state, nowMs, "ok"));
    } catch (error) {
      // Landing on a sign-in screen is the expected failure here. It is recorded so the
      // backoff widens, and nothing is shown to the user.
      telemetry.warn("money_import_daily_sweep_failed", {
        source_id: definition.sourceId,
        error_message: error instanceof Error ? error.message : String(error),
      });
      await autoRunStore.setState(definition.sourceId, nextAutoRunState(state, nowMs, "error"));
    } finally {
      await sessionStore.setSession(null);
      if (openedTabId !== null) {
        await chrome.tabs.remove(openedTabId).catch(() => {});
      }
    }
  }
}

if (chrome.alarms?.create) {
  void chrome.alarms.create(DAILY_IMPORT_ALARM, {
    periodInMinutes: DAILY_IMPORT_ALARM_PERIOD_MINUTES,
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== DAILY_IMPORT_ALARM) return;
    void runDailyImportSweep();
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "money-import-source-widget") return;

  port.onMessage.addListener(() => {
    // Keeping the port active is enough; payload contents are not needed.
  });
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  void (async () => {
    try {
      const response = await routeBackgroundMessage(
        message,
        {
          sessionStore,
          grantStore,
          debugStore,
          importRunnerDeps: {
            getConnector,
            callEdge,
            broadcastToAppTabs,
            broadcastToSourceTab,
            nowIso: () => new Date().toISOString(),
          },
        },
        {
          senderTabId: sender.tab?.id ?? null,
        },
      );

      if (message.type === "MONEY_IMPORT_START_SESSION") {
        const session =
          message.session && typeof message.session === "object"
            ? (message.session as Record<string, unknown>)
            : null;
        await syncSourcePageWidgetForSession(session);
      }

      if (message.type === "MONEY_IMPORT_RUN") {
        const currentSession = await sessionStore.getSession();
        await syncSourcePageWidgetForSession(currentSession);
      }

      if (message.type === "MONEY_IMPORT_RUN" && message.origin === "source_page_overlay") {
        await maybeOpenReportTab((response as Record<string, unknown>).report_url);
      }

      sendResponse(response);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown extension error";
      const diagnostics = extractErrorDiagnostics(error);
      telemetry.error("extension_background_message_error", {
        error_message: messageText,
        error_code: diagnostics?.code ?? null,
        edge_action: diagnostics?.action ?? null,
        edge_host: diagnostics?.function_host ?? null,
        edge_http_status:
          typeof diagnostics?.http_status === "number" ? diagnostics.http_status : null,
        edge_transport: diagnostics?.transport ?? null,
      });
      await broadcastToAppTabs({
        type: "MONEY_IMPORT_ERROR",
        error: messageText,
        diagnostics,
      });
      if (
        message.type === "MONEY_IMPORT_RUN" &&
        message.origin === "source_page_overlay" &&
        typeof sender.tab?.id === "number"
      ) {
        await broadcastToSourceTab(sender.tab.id, {
          type: "MONEY_IMPORT_ERROR",
          error: messageText,
          diagnostics,
        });
      }
      sendResponse({ ok: false, error: messageText, diagnostics });
    }
  })();

  return true;
});
