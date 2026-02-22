import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { installNoNetworkGuard } from "./no-network";

installNoNetworkGuard();

if (typeof window !== "undefined" && !("PointerEvent" in window)) {
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    writable: true,
    value: MouseEvent,
  });
}

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
