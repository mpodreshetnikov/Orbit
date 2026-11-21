import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_CLIENTS_QUERY_KEY, useMcpClients, useRevokeMcpClient } from "./use-mcp-clients";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
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

    const { result } = renderHook(() => useMcpClients(), { wrapper: createWrapper().wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      expect.objectContaining({ grantId: "grant-1", clientName: "Claude" }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/settings/mcp-clients");
  });

  it("treats a missing clients array as an empty list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    const { result } = renderHook(() => useMcpClients(), { wrapper: createWrapper().wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces a non-OK list response as an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("backend down", { status: 503 }));

    const { result } = renderHook(() => useMcpClients(), { wrapper: createWrapper().wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error("backend down"));
  });
});

describe("useRevokeMcpClient", () => {
  it("DELETE-revokes a grant and refreshes the clients query", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRevokeMcpClient(), { wrapper });

    let revokeResult: unknown;
    await act(async () => {
      revokeResult = await result.current.mutateAsync("grant-1");
    });

    expect(revokeResult).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/settings/mcp-clients/grant-1", {
      method: "DELETE",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: MCP_CLIENTS_QUERY_KEY });
  });

  it("surfaces the API error body on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));

    const { result } = renderHook(() => useRevokeMcpClient(), {
      wrapper: createWrapper().wrapper,
    });

    await expect(result.current.mutateAsync("missing")).rejects.toThrow("not found");
  });

  it("falls back to a status message when the error body is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    const { result } = renderHook(() => useRevokeMcpClient(), {
      wrapper: createWrapper().wrapper,
    });

    await expect(result.current.mutateAsync("grant-1")).rejects.toThrow(
      "Failed to revoke MCP client: 500",
    );
  });
});
