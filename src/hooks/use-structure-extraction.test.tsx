import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";

const { createClientMock, toastErrorMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = createTestQueryWrapper(queryClient);
  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  };
}

describe("use-structure-extraction", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    toastErrorMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("extracts structure successfully and invalidates related queries", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn(() => ({ eq: eqMock }));
    const fromMock = vi.fn(() => ({ update: updateMock }));
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-1" } },
        }),
      },
      from: fromMock,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          structured_data: { observations: [] },
        }),
      })),
    );

    const { useStructureExtraction } = await import("./use-structure-extraction");
    const { result, queryClient } = renderHookWithQueryClient(() => useStructureExtraction());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    let response:
      | {
          success: boolean;
          structured_data?: unknown;
          error?: string;
        }
      | undefined;
    await act(async () => {
      response = await result.current.extractStructure({ recordId: "record-1" });
    });

    expect(fromMock).toHaveBeenCalledWith("medical_records");
    expect(updateMock).toHaveBeenCalledWith({ status: "structuring" });
    expect(eqMock).toHaveBeenCalledWith("id", "record-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["medical-records"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["medical-record", "record-1"] });
    expect(response).toEqual({
      success: true,
      structured_data: { observations: [] },
    });
  });

  it("handles extraction failure and rolls status back to ocr_review", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";

    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn(() => ({ eq: eqMock }));
    const fromMock = vi.fn(() => ({ update: updateMock }));
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
        }),
      },
      from: fromMock,
    });

    const { useStructureExtraction } = await import("./use-structure-extraction");
    const { result, queryClient } = renderHookWithQueryClient(() => useStructureExtraction());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    let response:
      | {
          success: boolean;
          structured_data?: unknown;
          error?: string;
        }
      | undefined;
    await act(async () => {
      response = await result.current.extractStructure({ recordId: "record-1" });
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "processing.structureFailed",
      expect.objectContaining({
        description: "Not authenticated",
      }),
    );
    expect(updateMock).toHaveBeenCalledWith({ status: "ocr_review" });
    expect(eqMock).toHaveBeenCalledWith("id", "record-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["medical-records"] });
    expect(response).toEqual({
      success: false,
      error: "Not authenticated",
    });
  });
});
