const WEBAPP_SOURCE = "orbit-webapp";
const BRIDGE_SOURCE = "orbit-extension";

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string; session?: unknown };
  if (!data || data.source !== WEBAPP_SOURCE) return;

  if (data.type === "MONEY_IMPORT_PING") {
    chrome.runtime.sendMessage({ type: "MONEY_IMPORT_PING" }, () => {
      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          type: "MONEY_IMPORT_PONG",
          ts: Date.now(),
        },
        "*"
      );
    });
    return;
  }

  if (data.type === "MONEY_IMPORT_START_SESSION") {
    chrome.runtime.sendMessage(
      {
        type: "MONEY_IMPORT_START_SESSION",
        session: data.session,
      },
      (response: { ok?: boolean } | undefined) => {
        window.postMessage(
          {
            source: BRIDGE_SOURCE,
            type: "MONEY_IMPORT_SESSION_ACK",
            ok: Boolean(response?.ok),
          },
          "*"
        );
      }
    );
  }
});

chrome.runtime.onMessage.addListener((message: { type?: string } | null) => {
  if (!message || typeof message !== "object") return;
  if (
    !["MONEY_IMPORT_PROGRESS", "MONEY_IMPORT_DONE", "MONEY_IMPORT_ERROR"].includes(
      message.type ?? ""
    )
  ) {
    return;
  }

  window.postMessage(
    {
      source: BRIDGE_SOURCE,
      ...message,
    },
    "*"
  );
});
