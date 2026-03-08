import { createSourcePageWidget } from "./source-page-widget.js";

declare global {
  interface Window {
    __orbitSourcePageWidget?: ReturnType<typeof createSourcePageWidget>;
  }
}

if (typeof window !== "undefined") {
  if (!window.__orbitSourcePageWidget) {
    window.__orbitSourcePageWidget = createSourcePageWidget();
  }
  window.__orbitSourcePageWidget.mount();
}
