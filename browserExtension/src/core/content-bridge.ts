const WEBAPP_SOURCE = "orbit-webapp";
const BRIDGE_SOURCE = "orbit-extension";

type RuntimeSendMessage = (
  message: Record<string, unknown>,
  callback?: (
    response:
      | {
          ok?: boolean;
          extension_id?: string;
          extension_version?: string;
        }
      | undefined,
  ) => void,
) => void;

type WindowPostMessage = (message: Record<string, unknown>, targetOrigin: string) => void;

export interface ContentBridgeDeps {
  runtimeSendMessage: RuntimeSendMessage;
  windowPostMessage: WindowPostMessage;
  nowMs?: () => number;
  /** A structured warning; the console in a content script, which has no extension to relay to. */
  onWarning?: (event: string, attrs: Record<string, unknown>) => void;
}

export function createContentBridge(deps: ContentBridgeDeps) {
  const nowMs = deps.nowMs ?? (() => Date.now());

  /**
   * Sends to the extension, or tells the page that this bridge is dead.
   *
   * After the extension updates, a content script injected before the update keeps running in
   * its tab with no extension behind it: every runtime call throws "Extension context
   * invalidated" (2026-09-05, the attention page open through an update). The page cannot tell
   * that from an extension that is not installed -- both are silence -- so it is told outright,
   * and can reload itself to get the script the new version injects.
   */
  function sendToRuntime(
    message: Record<string, unknown>,
    callback?: Parameters<RuntimeSendMessage>[1],
  ): void {
    try {
      deps.runtimeSendMessage(message, callback);
    } catch (error) {
      // Said before it is handled: the page shows no reason, and a throw that is not the
      // invalidated context -- a payload the runtime cannot serialize, an API that is gone --
      // would otherwise vanish into the same notice.
      deps.onWarning?.("money_import_bridge_send_failed", {
        message_type: typeof message.type === "string" ? message.type : null,
        error_message: error instanceof Error ? error.message : String(error),
      });
      deps.windowPostMessage(
        {
          source: BRIDGE_SOURCE,
          type: "MONEY_IMPORT_BRIDGE_STALE",
          ts: nowMs(),
          reason: error instanceof Error ? error.message : String(error),
        },
        "*",
      );
    }
  }

  function handleWindowMessage(event: MessageEvent): void {
    if (event.source !== window) return;
    const data = event.data as {
      source?: string;
      type?: string;
      session?: unknown;
      grant?: unknown;
      request_id?: unknown;
      source_id?: unknown;
      stale_after_ms?: unknown;
    };
    if (!data || data.source !== WEBAPP_SOURCE) return;

    if (data.type === "MONEY_IMPORT_PING") {
      sendToRuntime({ type: "MONEY_IMPORT_PING" }, (response) => {
        deps.windowPostMessage(
          {
            source: BRIDGE_SOURCE,
            type: "MONEY_IMPORT_PONG",
            ts: nowMs(),
            extension_id:
              typeof response?.extension_id === "string" ? response.extension_id : undefined,
            extension_version:
              typeof response?.extension_version === "string"
                ? response.extension_version
                : undefined,
          },
          "*",
        );
      });
      return;
    }

    if (data.type === "MONEY_IMPORT_SET_GRANT") {
      sendToRuntime(
        {
          type: "MONEY_IMPORT_SET_GRANT",
          grant: data.grant as Record<string, unknown>,
        },
        (response: { ok?: boolean } | undefined) => {
          // The app reports success only on this ack. Before the extension had a receiver at
          // all, the page posted into nothing and said the key had been delivered -- which is
          // how a one-time credential gets thrown away.
          deps.windowPostMessage(
            {
              source: BRIDGE_SOURCE,
              type: "MONEY_IMPORT_GRANT_ACK",
              ok: Boolean(response?.ok),
            },
            "*",
          );
        },
      );
      return;
    }

    if (data.type === "MONEY_IMPORT_GET_AUTO_STATUS") {
      // Echoed so the page can tell which of its requests a reply answers: two refreshes in
      // flight -- a Re-check while the post-grant refresh is pending -- would otherwise both
      // take the first reply, and the newer one would show the state from before the grant.
      const requestId = typeof data.request_id === "string" ? data.request_id : null;
      sendToRuntime(
        { type: "MONEY_IMPORT_GET_AUTO_STATUS" },
        (response: Record<string, unknown> | undefined) => {
          deps.windowPostMessage(
            {
              source: BRIDGE_SOURCE,
              type: "MONEY_IMPORT_AUTO_STATUS",
              request_id: requestId,
              ok: Boolean(response?.ok),
              grant: response?.grant ?? null,
              sources: Array.isArray(response?.sources) ? response.sources : [],
            },
            "*",
          );
        },
      );
      return;
    }

    // The attention page's three requests, each answered with the runtime's reply and the
    // request id echoed, for the same reason as the status above.
    if (data.type === "MONEY_IMPORT_GET_ATTENTION") {
      const requestId = typeof data.request_id === "string" ? data.request_id : null;
      sendToRuntime(
        { type: "MONEY_IMPORT_GET_ATTENTION" },
        (response: Record<string, unknown> | undefined) => {
          deps.windowPostMessage(
            {
              source: BRIDGE_SOURCE,
              type: "MONEY_IMPORT_ATTENTION",
              request_id: requestId,
              ok: Boolean(response?.ok),
              grant: response?.grant ?? null,
              stale_after_ms:
                typeof response?.stale_after_ms === "number" ? response.stale_after_ms : null,
              stale_count: typeof response?.stale_count === "number" ? response.stale_count : 0,
              sources: Array.isArray(response?.sources) ? response.sources : [],
            },
            "*",
          );
        },
      );
      return;
    }

    if (data.type === "MONEY_IMPORT_REQUEST_RUN") {
      const requestId = typeof data.request_id === "string" ? data.request_id : null;
      sendToRuntime(
        { type: "MONEY_IMPORT_REQUEST_RUN", source_id: data.source_id },
        (response: Record<string, unknown> | undefined) => {
          deps.windowPostMessage(
            {
              source: BRIDGE_SOURCE,
              type: "MONEY_IMPORT_RUN_REQUEST_ACK",
              request_id: requestId,
              ok: Boolean(response?.ok),
              error: typeof response?.error === "string" ? response.error : null,
              source_id: typeof response?.source_id === "string" ? response.source_id : null,
            },
            "*",
          );
        },
      );
      return;
    }

    if (data.type === "MONEY_IMPORT_SET_ATTENTION_SETTINGS") {
      const requestId = typeof data.request_id === "string" ? data.request_id : null;
      sendToRuntime(
        { type: "MONEY_IMPORT_SET_ATTENTION_SETTINGS", stale_after_ms: data.stale_after_ms },
        (response: Record<string, unknown> | undefined) => {
          deps.windowPostMessage(
            {
              source: BRIDGE_SOURCE,
              type: "MONEY_IMPORT_ATTENTION_SETTINGS_ACK",
              request_id: requestId,
              ok: Boolean(response?.ok),
              stale_after_ms:
                typeof response?.stale_after_ms === "number" ? response.stale_after_ms : null,
            },
            "*",
          );
        },
      );
      return;
    }

    if (data.type === "MONEY_IMPORT_START_SESSION") {
      sendToRuntime(
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
