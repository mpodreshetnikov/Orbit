import "./connectors/tbank-web.js";
import { getConnector } from "./connectors/registry.js";
import { APP_ORIGIN_PATTERNS, DEV_HOT_RELOAD } from "./env.js";

const SESSION_STORAGE_KEY = "extension_import_session";

async function getStoredSession(): Promise<Record<string, unknown> | null> {
  const data = await chrome.storage.local.get([SESSION_STORAGE_KEY]);
  return (data[SESSION_STORAGE_KEY] as Record<string, unknown> | undefined) ?? null;
}

async function setStoredSession(session: Record<string, unknown> | null): Promise<void> {
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
}

async function broadcastToAppTabs(message: Record<string, unknown>): Promise<void> {
  if (!Array.isArray(APP_ORIGIN_PATTERNS) || APP_ORIGIN_PATTERNS.length === 0) {
    return;
  }

  const tabs = await chrome.tabs.query({
    url: APP_ORIGIN_PATTERNS,
  });

  await Promise.all(
    tabs.map((tab) =>
      chrome.tabs.sendMessage(tab.id!, message).catch(() => null)
    )
  );
}

let devBuildId: string | null = null;

async function checkDevHotReload(): Promise<void> {
  try {
    const response = await fetch(
      `${chrome.runtime.getURL("reload-trigger.json")}?_=${Date.now()}`
    );
    if (!response.ok) return;

    const payload = (await response.json()) as { buildId?: string };
    const nextBuildId =
      payload && typeof payload.buildId === "string" ? payload.buildId : null;
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
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    throw new Error((data.error as string) || "Money import edge request failed");
  }
  return data;
}

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; session?: Record<string, unknown>; windowFrom?: string },
    _sender,
    sendResponse
  ) => {
    (async () => {
      try {
        if (message.type === "MONEY_IMPORT_PING") {
          sendResponse({ ok: true });
          return;
        }

        if (message.type === "MONEY_IMPORT_START_SESSION") {
          await setStoredSession(message.session ?? null);
          sendResponse({ ok: true });
          return;
        }

        if (message.type === "MONEY_IMPORT_GET_SESSION") {
          const session = await getStoredSession();
          sendResponse({ ok: true, session });
          return;
        }

        if (message.type === "MONEY_IMPORT_RUN") {
          const session = await getStoredSession();
          if (!session) {
            throw new Error("No active import session");
          }

          try {
            const connector = getConnector((session.source as string) ?? "");
            if (!connector) {
              throw new Error(`No connector for source: ${session.source}`);
            }

            const windowFrom =
              message.windowFrom ||
              (session.last_imported_at as string) ||
              new Date().toISOString();
            const parseOutput = await connector.parse({
              source: session.source as string,
              windowFrom,
              session,
            });

            await broadcastToAppTabs({
              type: "MONEY_IMPORT_PROGRESS",
              parsed_transactions_count: parseOutput.parsedTransactionsCount,
              parsed_through_at: parseOutput.parsedThroughAt,
            });

            const applyResult = (await callEdge(
              session.function_url as string,
              session.session_token as string,
              {
                action: "apply_rows",
                session_id: session.session_id,
                batch_id: session.batch_id,
                window_from: windowFrom,
                window_to: parseOutput.windowTo,
                parsed_through_at: parseOutput.parsedThroughAt,
                parsed_transactions_count: parseOutput.parsedTransactionsCount,
                rows: parseOutput.rows,
              }
            )) as { batch_id?: string };

            await callEdge(
              session.function_url as string,
              session.session_token as string,
              {
                action: "complete_session",
                session_id: session.session_id,
                batch_id: session.batch_id,
                status: "completed",
              }
            );

            await broadcastToAppTabs({
              type: "MONEY_IMPORT_DONE",
              batch_id: applyResult.batch_id ?? session.batch_id,
            });

            sendResponse({ ok: true, result: applyResult });
            return;
          } catch (runError) {
            try {
              await callEdge(
                session.function_url as string,
                session.session_token as string,
                {
                  action: "complete_session",
                  session_id: session.session_id,
                  batch_id: session.batch_id,
                  status: "failed",
                }
              );
            } catch {
              // Ignore completion failures; original error is still reported to UI.
            }
            throw runError;
          }
        }

        sendResponse({ ok: false, error: "Unsupported message type" });
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Unknown extension error";
        await broadcastToAppTabs({
          type: "MONEY_IMPORT_ERROR",
          error: messageText,
        });
        sendResponse({ ok: false, error: messageText });
      }
    })();

    return true;
  }
);
