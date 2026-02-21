import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  createClient: createClientMock,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useIcdLookup + useIcdSearch", () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    createClientMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  });

  it("looks up ICD code when authenticated", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-1" } },
        }),
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          found: true,
          code: "D50.9",
          name_en: "Iron deficiency anemia, unspecified",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const { useIcdLookup } = await import("./use-icd-lookup");
    const { result } = renderHook(() => useIcdLookup("D50.9"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      found: true,
      code: "D50.9",
      name_en: "Iron deficiency anemia, unspecified",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://project.supabase.co/functions/v1/icd-lookup",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token-1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: "D50.9" }),
      }),
    );
  });

  it("reports error when user is not authenticated", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
        }),
      },
    });

    const { useIcdLookup } = await import("./use-icd-lookup");
    const { result } = renderHook(() => useIcdLookup("D50.9"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe("Not authenticated");
  });

  it("returns search results from edge function", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-2" } },
        }),
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { code: "G43.0", name_en: "Migraine without aura" },
            { code: "G43.1", name_en: "Migraine with aura" },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const { useIcdSearch } = await import("./use-icd-lookup");
    const { result } = renderHook(() => useIcdSearch("migraine", "en"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { code: "G43.0", name_en: "Migraine without aura" },
      { code: "G43.1", name_en: "Migraine with aura" },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://project.supabase.co/functions/v1/icd-lookup",
      expect.objectContaining({
        body: JSON.stringify({ search: "migraine", lang: "en", maxResults: 15 }),
      }),
    );
  });

  it("keeps lookup and condition naming helpers deterministic", async () => {
    const { getLocalizedIcdName, getConditionIcdName } = await import("./use-icd-lookup");

    expect(
      getLocalizedIcdName({
        code: "G43",
        name_en: "Migraine",
        name_ru: "Мигрень",
        found: true,
      }),
    ).toBe("Migraine");
    expect(
      getLocalizedIcdName({
        code: "G43",
        name_en: null,
        name_ru: null,
        found: false,
      }),
    ).toBeNull();
    expect(getConditionIcdName("Migraine", "Мигрень", "ru")).toBe("Migraine");
    expect(getConditionIcdName(null, "Мигрень", "ru")).toBeNull();
  });

  it("does not run lookup for short code input", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn(),
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const { useIcdLookup } = await import("./use-icd-lookup");
    const { result } = renderHook(() => useIcdLookup("D"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  afterEach(() => {
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }
  });
});
