import "./connectors/tbank-web.js";
import { getConnector } from "./connectors/registry.js";
import { APP_ORIGIN_PATTERNS, DEV_HOT_RELOAD } from "./env.js";
import { routeBackgroundMessage, type BackgroundMessage } from "./core/background-router.js";
import { createExtensionLogger } from "./core/observability.js";
import { createSessionStore } from "./core/session-store.js";

async function broadcastToAppTabs(message: Record<string, unknown>): Promise<void> {
  if (!Array.isArray(APP_ORIGIN_PATTERNS) || APP_ORIGIN_PATTERNS.length === 0) {
    return;
  }

  const tabs = await chrome.tabs.query({
    url: APP_ORIGIN_PATTERNS,
  });

  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id!, message).catch(() => null)));
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
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error((data.error as string) || "Money import edge request failed");
  }
  return data;
}

const sessionStore = createSessionStore(chrome.storage.local);
const telemetry = createExtensionLogger("background");
telemetry.info("extension_background_initialized", {
  dev_hot_reload: DEV_HOT_RELOAD,
  app_origin_pattern_count: Array.isArray(APP_ORIGIN_PATTERNS) ? APP_ORIGIN_PATTERNS.length : 0,
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  void (async () => {
    try {
      const response = await routeBackgroundMessage(message, {
        sessionStore,
        importRunnerDeps: {
          getConnector,
          callEdge,
          broadcastToAppTabs,
          nowIso: () => new Date().toISOString(),
        },
      });
      sendResponse(response);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown extension error";
      telemetry.error("extension_background_message_error", {
        error_message: messageText,
      });
      await broadcastToAppTabs({
        type: "MONEY_IMPORT_ERROR",
        error: messageText,
      });
      sendResponse({ ok: false, error: messageText });
    }
  })();

  return true;
});
