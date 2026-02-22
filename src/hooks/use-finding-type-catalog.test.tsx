import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";
import { createQueryBuilder } from "../../test/utils/web/supabase-query";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = createTestQueryWrapper(queryClient);
  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  };
}

describe("use-finding-type-catalog", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("fetches finding type catalog", async () => {
    const rows = [{ id: "ft-1", finding_code: "nodule", name_ru: "Узел", name_en: "Nodule" }];
    const builder = createQueryBuilder({ data: rows, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useFindingTypeCatalog } = await import("./use-finding-type-catalog");
    const { result } = renderHookWithQueryClient(() => useFindingTypeCatalog());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(builder.order).toHaveBeenCalledWith("finding_code");
  });

  it("returns query error", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "finding type failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useFindingTypeCatalog } = await import("./use-finding-type-catalog");
    const { result } = renderHookWithQueryClient(() => useFindingTypeCatalog());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("finding type failed");
  });

  it("creates finding type and invalidates list", async () => {
    const created = { id: "ft-1", finding_code: "nodule", name_ru: "Узел", name_en: "Nodule" };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCreateFindingType } = await import("./use-finding-type-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateFindingType());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        finding_code: "nodule",
        name_ru: "Узел",
        name_en: "Nodule",
      });
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        finding_code: "nodule",
        name_en: "Nodule",
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["finding-type-catalog"] });
  });

  it("updates finding type and invalidates list", async () => {
    const updated = { id: "ft-1", finding_code: "nodule", name_ru: "Узелок", name_en: "Nodule" };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useUpdateFindingType } = await import("./use-finding-type-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateFindingType());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "ft-1",
        updates: { name_ru: "Узелок" },
      });
    });

    expect(builder.update).toHaveBeenCalledWith({ name_ru: "Узелок" });
    expect(builder.eq).toHaveBeenCalledWith("id", "ft-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["finding-type-catalog"] });
  });

  it("deletes finding type and invalidates list", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDeleteFindingType } = await import("./use-finding-type-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteFindingType());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync("ft-1");
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "ft-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["finding-type-catalog"] });
  });
});
