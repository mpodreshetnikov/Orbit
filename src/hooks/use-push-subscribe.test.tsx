import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePushSubscribe } from "./use-push-subscribe";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("usePushSubscribe", () => {
  it("submits subscription payload to API", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    const { result } = renderHook(() => usePushSubscribe(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        endpoint: "https://push.example/sub",
        keys: { p256dh: "p256", auth: "auth" },
      });
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/push-subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://push.example/sub",
        keys: { p256dh: "p256", auth: "auth" },
      }),
    });
  });

  it("throws API response text when subscription request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not allowed", { status: 401 }));

    const { result } = renderHook(() => usePushSubscribe(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        endpoint: "https://push.example/sub",
        keys: { p256dh: "p256", auth: "auth" },
      }),
    ).rejects.toThrow("not allowed");
  });
});
