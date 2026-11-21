import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMcpClients, useRevokeMcpClient } from "./use-mcp-clients";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMcpClients", () => {
  it("loads connected clients from the settings API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          clients: [
            {
              grantId: "grant-1",
              clientId: "client-1",
              clientName: "Claude",
              scope: "openid",
              createdAt: "2026-11-19T12:00:00.000Z",
              lastUsedAt: null,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useMcpClients(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      expect.objectContaining({ grantId: "grant-1", clientName: "Claude" }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/settings/mcp-clients");
  });
});

describe("useRevokeMcpClient", () => {
  it("DELETE-revokes a grant", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useRevokeMcpClient(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync("grant-1");
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/settings/mcp-clients/grant-1", {
      method: "DELETE",
    });
  });

  it("surfaces the API error body on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));

    const { result } = renderHook(() => useRevokeMcpClient(), { wrapper: createWrapper() });

    await expect(result.current.mutateAsync("missing")).rejects.toThrow("not found");
  });
});
