import { createContentBridge } from "./core/content-bridge";

const bridge = createContentBridge({
  runtimeSendMessage: (message, callback) => {
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
      return;
    }
    void chrome.runtime.sendMessage(message);
  },
  windowPostMessage: window.postMessage.bind(window),
  // The extension's logger relays through the runtime, which is what just failed; the console
  // carries the same structured line and needs nothing behind it.
  onWarning: (event, attrs) => {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        app: "extension",
        component: "content-script",
        message: event,
        attrs,
      }),
    );
  },
});

window.addEventListener("message", bridge.handleWindowMessage);
chrome.runtime.onMessage.addListener(bridge.handleRuntimeMessage);
