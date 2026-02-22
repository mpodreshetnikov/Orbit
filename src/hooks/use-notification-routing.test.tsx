import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  createClient: createClientMock,
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useNotificationRouting + useUpdateNotificationRouting", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns empty state when user is not authenticated", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: vi.fn(),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { useNotificationRouting } = await import("./use-notification-routing");
    const { result } = renderHook(() => useNotificationRouting(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ userId: null, rows: [] });
  });

  it("returns rows for authenticated user", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: "routing-1", recipient_user_id: "user-1", person_id: "person-1", enabled: true },
      ],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { useNotificationRouting } = await import("./use-notification-routing");
    const { result } = renderHook(() => useNotificationRouting(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith("notification_routing");
    expect(result.current.data).toEqual({
      userId: "user-1",
      rows: [
        {
          id: "routing-1",
          recipient_user_id: "user-1",
          person_id: "person-1",
          enabled: true,
        },
      ],
    });
  });

  it("throws not authenticated on update when user is missing", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: vi.fn(),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { useUpdateNotificationRouting } = await import("./use-notification-routing");
    const { result } = renderHook(() => useUpdateNotificationRouting(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.mutateAsync({
        person_id: "person-1",
        enabled: true,
        custom_prefix: "A",
      }),
    ).rejects.toThrow("Not authenticated");
  });

  it("upserts routing row and invalidates query", async () => {
    const invalidateQueries = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "routing-1",
        recipient_user_id: "user-1",
        person_id: "person-1",
        enabled: false,
      },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { useUpdateNotificationRouting } = await import("./use-notification-routing");
    const { result } = renderHook(() => useUpdateNotificationRouting(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.mutateAsync({
      person_id: "person-1",
      enabled: false,
      custom_prefix: null,
    });

    expect(upsert).toHaveBeenCalledWith(
      {
        recipient_user_id: "user-1",
        person_id: "person-1",
        enabled: false,
        custom_prefix: null,
      },
      { onConflict: "recipient_user_id,person_id" },
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["notification-routing"] });
    invalidateQueries.mockRestore();
  });
});
