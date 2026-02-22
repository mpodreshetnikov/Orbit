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

describe("use-measurement-catalog", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("fetches catalog with search", async () => {
    const rows = [
      {
        id: "m-1",
        code: "weight",
        name_ru: "Вес",
        name_en: "Weight",
        unit_ru: "кг",
        unit_en: "kg",
        category: "body",
      },
    ];
    const builder = createQueryBuilder({ data: rows, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useMeasurementCatalog } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useMeasurementCatalog("wei"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(builder.order).toHaveBeenCalledWith("category", { ascending: true });
    expect(builder.order).toHaveBeenCalledWith("sort_order", { ascending: true });
    expect(builder.or).toHaveBeenCalledWith(expect.stringContaining("code.ilike.%wei%"));
  });

  it("fetches catalog without search and handles empty response", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMeasurementCatalog } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useMeasurementCatalog("   "));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(builder.or).not.toHaveBeenCalled();
  });

  it("returns fetch errors for catalog list", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "catalog list failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMeasurementCatalog } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useMeasurementCatalog());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("catalog list failed");
  });

  it("disables single-item query without id", async () => {
    const { useMeasurementCatalogItem } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useMeasurementCatalogItem(null));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns null/error branches for single item by id", async () => {
    const notFoundBuilder = createQueryBuilder({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => notFoundBuilder) });

    const { useMeasurementCatalogItem } = await import("./use-measurement-catalog");
    const notFound = renderHookWithQueryClient(() => useMeasurementCatalogItem("m-unknown"));
    await waitFor(() => expect(notFound.result.current.isSuccess).toBe(true));
    expect(notFound.result.current.data).toBeNull();

    const errorBuilder = createQueryBuilder({
      data: null,
      error: { code: "boom", message: "single item failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => errorBuilder) });
    const error = renderHookWithQueryClient(() => useMeasurementCatalogItem("m-1"));
    await waitFor(() => expect(error.result.current.isError).toBe(true));
    expect((error.result.current.error as Error).message).toContain("single item failed");
  });

  it("returns null when catalog item by code is missing", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useMeasurementCatalogByCode } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useMeasurementCatalogByCode("unknown"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(builder.eq).toHaveBeenCalledWith("code", "unknown");
  });

  it("disables query by code when code is null", async () => {
    const { useMeasurementCatalogByCode } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useMeasurementCatalogByCode(null));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns query errors when loading item by code", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { code: "boom", message: "code lookup failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMeasurementCatalogByCode } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useMeasurementCatalogByCode("weight"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("code lookup failed");
  });

  it("creates catalog item and invalidates list", async () => {
    const created = {
      id: "m-1",
      code: "weight",
      name_ru: "Вес",
      name_en: "Weight",
      unit_ru: "кг",
      unit_en: "kg",
      category: "body",
      sort_order: 1,
    };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCreateMeasurementCatalogItem } = await import("./use-measurement-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useCreateMeasurementCatalogItem(),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        code: "weight",
        name_ru: "Вес",
        name_en: "Weight",
        unit_ru: "кг",
        unit_en: "kg",
        category: "body",
        sort_order: 1,
      });
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "weight",
        category: "body",
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["measurement-catalog"],
    });
  });

  it("creates with default sort order and propagates create errors", async () => {
    const errorBuilder = createQueryBuilder({
      data: null,
      error: { message: "create failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => errorBuilder) });

    const { useCreateMeasurementCatalogItem } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useCreateMeasurementCatalogItem());

    await expect(
      result.current.mutateAsync({
        code: "pulse",
        name_ru: "Pulse",
        name_en: "Pulse",
        unit_ru: "bpm",
        unit_en: "bpm",
        category: "vital",
      }),
    ).rejects.toThrow("create failed");
    expect(errorBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        sort_order: 0,
      }),
    );
  });

  it("updates catalog item and invalidates list + detail + code keys", async () => {
    const updated = {
      id: "m-1",
      code: "weight",
      name_ru: "Масса",
      name_en: "Weight",
      unit_ru: "кг",
      unit_en: "kg",
      category: "body",
      sort_order: 1,
    };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useUpdateMeasurementCatalogItem } = await import("./use-measurement-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useUpdateMeasurementCatalogItem(),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "m-1",
        updates: { name_ru: "Масса" },
      });
    });

    expect(builder.update).toHaveBeenCalledWith({ name_ru: "Масса" });
    expect(builder.eq).toHaveBeenCalledWith("id", "m-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["measurement-catalog"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["measurement-catalog-item", "m-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["measurement-catalog-code", "weight"],
    });
  });

  it("returns update errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "update failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useUpdateMeasurementCatalogItem } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useUpdateMeasurementCatalogItem());

    await expect(
      result.current.mutateAsync({
        id: "m-1",
        updates: { name_en: "Updated" },
      }),
    ).rejects.toThrow("update failed");
  });

  it("deletes catalog item and invalidates list", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDeleteMeasurementCatalogItem } = await import("./use-measurement-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useDeleteMeasurementCatalogItem(),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync("m-1");
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "m-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["measurement-catalog"],
    });
  });

  it("returns delete errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "delete failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteMeasurementCatalogItem } = await import("./use-measurement-catalog");
    const { result } = renderHookWithQueryClient(() => useDeleteMeasurementCatalogItem());

    await expect(result.current.mutateAsync("m-1")).rejects.toThrow("delete failed");
  });
});
