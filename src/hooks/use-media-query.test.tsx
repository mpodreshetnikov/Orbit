import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIsDesktop, useIsMobile, useMediaQuery } from "./use-media-query";

describe("useMediaQuery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn(),
      });
    }
  });

  it("tracks matchMedia state updates", () => {
    let currentMatches = false;
    let changeListener: ((event: MediaQueryListEvent) => void) | undefined;

    vi.spyOn(window, "matchMedia").mockImplementation(
      () =>
        ({
          matches: currentMatches,
          media: "(min-width: 768px)",
          onchange: null,
          addEventListener: (_event: string, cb: (event: MediaQueryListEvent) => void) => {
            changeListener = cb;
          },
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);

    act(() => {
      currentMatches = true;
      changeListener?.({ matches: true } as MediaQueryListEvent);
    });

    expect(result.current).toBe(true);
  });

  it("useIsDesktop/useIsMobile map md breakpoint query", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      () =>
        ({
          matches: true,
          media: "(min-width: 768px)",
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    const { result: desktop } = renderHook(() => useIsDesktop());
    const { result: mobile } = renderHook(() => useIsMobile());

    expect(desktop.current).toBe(true);
    expect(mobile.current).toBe(false);
  });
});
