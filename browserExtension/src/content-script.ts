const WEBAPP_SOURCE = "orbit-webapp";
const BRIDGE_SOURCE = "orbit-extension";

type RuntimeSendMessage = (
  message: Record<string, unknown>,
  callback?: (response: { ok?: boolean } | undefined) => void,
) => void;

type WindowPostMessage = (message: Record<string, unknown>, targetOrigin: string) => void;

interface ContentBridgeDeps {
  runtimeSendMessage: RuntimeSendMessage;
  windowPostMessage: WindowPostMessage;
  nowMs?: () => number;
}

function createContentBridge(deps: ContentBridgeDeps) {
  const nowMs = deps.nowMs ?? (() => Date.now());

  function handleWindowMessage(event: MessageEvent): void {
    if (event.source !== window) return;
    const data = event.data as { source?: string; type?: string; session?: unknown };
    if (!data || data.source !== WEBAPP_SOURCE) return;

    if (data.type === "MONEY_IMPORT_PING") {
      deps.runtimeSendMessage({ type: "MONEY_IMPORT_PING" }, () => {
        deps.windowPostMessage(
          {
            source: BRIDGE_SOURCE,
            type: "MONEY_IMPORT_PONG",
            ts: nowMs(),
          },
          "*",
        );
      });
      return;
    }

    if (data.type === "MONEY_IMPORT_START_SESSION") {
      deps.runtimeSendMessage(
        {
          type: "MONEY_IMPORT_START_SESSION",
          session: data.session as Record<string, unknown>,
        },
        (response: { ok?: boolean } | undefined) => {
          deps.windowPostMessage(
            {
              source: BRIDGE_SOURCE,
              type: "MONEY_IMPORT_SESSION_ACK",
              ok: Boolean(response?.ok),
            },
            "*",
          );
        },
      );
    }
  }

  function handleRuntimeMessage(
    message: (Record<string, unknown> & { type?: string }) | null,
  ): void {
    if (!message || typeof message !== "object") return;
    if (
      ![
        "MONEY_IMPORT_PROGRESS",
        "MONEY_IMPORT_DONE",
        "MONEY_IMPORT_ERROR",
        "MONEY_IMPORT_DEBUG_STATUS",
      ].includes(message.type ?? "")
    ) {
      return;
    }

    deps.windowPostMessage(
      {
        source: BRIDGE_SOURCE,
        ...message,
      },
      "*",
    );
  }

  return {
    handleWindowMessage,
    handleRuntimeMessage,
  };
}

const bridge = createContentBridge({
  runtimeSendMessage: (message, callback) => {
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
      return;
    }
    void chrome.runtime.sendMessage(message);
  },
  windowPostMessage: window.postMessage.bind(window),
});

window.addEventListener("message", bridge.handleWindowMessage);
chrome.runtime.onMessage.addListener(bridge.handleRuntimeMessage);
