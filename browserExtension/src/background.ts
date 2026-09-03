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
import { createAutoImportSweep } from "./core/auto-import-sweep.js";
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

const AUTO_IMPORT_ALARM = "money-import-auto";
/**
 * A visit does not start a sweep; it schedules one. The person who just opened their bank may
 * be about to import by hand, and a sweep opening a second copy of the same bank in that moment
 * put two connectors on one site at once -- the bank redirected one and the run failed with
 * "did not stay on the operations page". One minute later, a manual run that has begun holds
 * the session field and the sweep stands down; one that has not is not coming.
 *
 * A chrome.alarm rather than setTimeout because the service worker does not survive a minute
 * idle. Creating an alarm with a name that already exists replaces it, so repeated navigations
 * inside the bank keep pushing the deadline out: the sweep waits for the person to stop moving.
 */
const VISIT_SWEEP_ALARM_PREFIX = "money-import-visit:";
const VISIT_SWEEP_DELAY_MINUTES = 1;
/**
 * How often the alarm asks whether anything is due. The cooldown decides whether a run actually
 * happens, so this only has to be short enough that a machine awake for a few hours a day still
 * gets asked.
 */
const AUTO_IMPORT_ALARM_PERIOD_MINUTES = 180;
const AUTO_IMPORT_TAB_LOAD_TIMEOUT_MS = 30_000;
const AUTO_IMPORT_TAB_POLL_INTERVAL_MS = 500;

const autoImportSweep = createAutoImportSweep({
  listSources: () =>
    listMoneyImportSourceDefinitions()
      .filter((definition) => Boolean(definition.targetUrl))
      .map((definition) => ({
        sourceId: definition.sourceId,
        targetUrl: definition.targetUrl,
      })),
  grantStore,
  sessionStore,
  autoRunStore,
  openTab: async (url) => {
    const created = await chrome.tabs.create({ url, active: false });
    return typeof created.id === "number" ? created.id : null;
  },
  waitForTabComplete: async (tabId) => {
    const startedAtMs = Date.now();
    while (Date.now() - startedAtMs < AUTO_IMPORT_TAB_LOAD_TIMEOUT_MS) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) return false;
      if (tab.status === "complete") return true;
      await new Promise((resolve) => setTimeout(resolve, AUTO_IMPORT_TAB_POLL_INTERVAL_MS));
    }
    return false;
  },
  closeTab: async (tabId) => {
    await chrome.tabs.remove(tabId).catch(() => {});
  },
  runImport: async ({ grant, sourceId, tabId, nowMs }) =>
    await runScheduledImport(
      {
        sourceId,
        payerPersonId: grant.person_id,
        nowMs,
        functionUrl: grant.function_url,
        credentials: { grantToken: grant.token },
        appOrigin: grant.app_origin || null,
        // Nobody is looking at this tab; the widget is for a run a person started.
        showSourcePageWidget: false,
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
    ),
  now: () => Date.now(),
  onWarning: (event, attrs) => telemetry.warn(event, attrs),
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const nextUrl = typeof changeInfo.url === "string" ? changeInfo.url : tab.url;
  if (!nextUrl) return;
  const isComplete = changeInfo.status === "complete";
  const hasNavigated = typeof changeInfo.url === "string";
  if (!isComplete && !hasNavigated) return;

  void (async () => {
    const session = await sessionStore.getSession();
    if (!session) {
      // A finished load on a bank page is the one moment the extension knows the person's bank
      // session is live. It is a signal only -- for that bank, not for every bank the grant
      // covers -- and the sweep it schedules works in a tab of its own.
      if (isComplete) {
        const visited = listMoneyImportSourceDefinitions().find((definition) =>
          matchesMoneyImportSourcePageUrl(definition.sourceId, nextUrl),
        );
        if (visited && chrome.alarms?.create) {
          await chrome.alarms.create(`${VISIT_SWEEP_ALARM_PREFIX}${visited.sourceId}`, {
            delayInMinutes: VISIT_SWEEP_DELAY_MINUTES,
          });
        }
      }
      return;
    }
    await syncSourcePageWidgetForSession(session, { tabId, tabUrl: nextUrl });
  })();
});

/**
 * Creates the alarm once, and only when it is not already there.
 *
 * `alarms.create` on an existing name replaces it and restarts its period. A service worker is
 * torn down whenever it goes idle and rebuilt on the next event, so re-creating unconditionally
 * on every startup means a three-hour alarm on a busy machine is reset long before it ever
 * fires, and the fallback that exists for people who do not visit their bank never runs.
 */
async function ensureAutoImportAlarm(): Promise<void> {
  if (!chrome.alarms?.create) return;
  const existing = await chrome.alarms.get(AUTO_IMPORT_ALARM).catch(() => null);
  if (existing) return;
  await chrome.alarms.create(AUTO_IMPORT_ALARM, {
    periodInMinutes: AUTO_IMPORT_ALARM_PERIOD_MINUTES,
  });
}

/**
 * A new version is the one moment the extension has reason to believe a failed run might
 * succeed now. The backoff cannot tell a signed-out bank from a connector that was broken, and
 * kept a fixed connector silent for the rest of the day after the fix was installed.
 */
chrome.runtime.onInstalled?.addListener((details) => {
  if (details.reason !== "update") return;
  void autoRunStore.forgiveFailures().then((forgiven) => {
    if (forgiven === 0) return;
    telemetry.info("money_import_auto_failures_forgiven", {
      scopes: forgiven,
      previous_version: details.previousVersion ?? null,
    });
  });
});

if (chrome.alarms?.onAlarm) {
  void ensureAutoImportAlarm();
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_IMPORT_ALARM) {
      void autoImportSweep.run("alarm");
      return;
    }
    if (alarm.name.startsWith(VISIT_SWEEP_ALARM_PREFIX)) {
      const sourceId = alarm.name.slice(VISIT_SWEEP_ALARM_PREFIX.length);
      void autoImportSweep.run("visit", { sourceId });
    }
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
          autoRunStore,
          debugStore,
          listAutoImportSources: () =>
            listMoneyImportSourceDefinitions()
              .filter((definition) => Boolean(definition.targetUrl))
              .map((definition) => definition.sourceId),
          listScheduledSweeps: async () => {
            if (!chrome.alarms?.getAll) return [];
            const alarms = await chrome.alarms.getAll().catch(() => []);
            return alarms
              .filter((alarm) => alarm.name.startsWith(VISIT_SWEEP_ALARM_PREFIX))
              .map((alarm) => ({
                sourceId: alarm.name.slice(VISIT_SWEEP_ALARM_PREFIX.length),
                atMs: alarm.scheduledTime,
              }));
          },
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
