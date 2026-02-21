import { createContentBridge } from "./core/content-bridge.js";

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
