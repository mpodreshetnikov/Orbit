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

const catalogKey = ["body-site-catalog"];
const otherCatalogKey = ["finding-type-catalog"];

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = createTestQueryWrapper(queryClient);
  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  };
}

describe("use-body-site-catalog", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("fetches body site catalog", async () => {
    const rows = [{ id: "site-1", site_code: "lung", name_ru: "Легкое", name_en: "Lung" }];
    const builder = createQueryBuilder({ data: rows, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useBodySiteCatalog } = await import("./use-body-site-catalog");
    const { result } = renderHookWithQueryClient(() => useBodySiteCatalog());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(builder.order).toHaveBeenCalledWith("site_code");
  });

  it("returns query error", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "body site failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useBodySiteCatalog } = await import("./use-body-site-catalog");
    const { result } = renderHookWithQueryClient(() => useBodySiteCatalog());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("body site failed");
  });

  it("creates body site and invalidates list", async () => {
    const created = { id: "site-1", site_code: "lung", name_ru: "Легкое", name_en: "Lung" };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCreateBodySite } = await import("./use-body-site-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateBodySite());
    queryClient.setQueryData(catalogKey, []);
    queryClient.setQueryData(otherCatalogKey, []);

    await act(async () => {
      const row = await result.current.mutateAsync({
        site_code: "lung",
        name_ru: "Легкое",
        name_en: "Lung",
      });
      expect(row).toEqual(created);
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        site_code: "lung",
        name_en: "Lung",
      }),
    );
    expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherCatalogKey)?.isInvalidated).toBe(false);
  });

  it("updates body site and invalidates list", async () => {
    const updated = { id: "site-1", site_code: "lung", name_ru: "Левое легкое", name_en: "Lung" };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useUpdateBodySite } = await import("./use-body-site-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateBodySite());
    queryClient.setQueryData(catalogKey, [{ ...updated, name_ru: "Легкое" }]);
    queryClient.setQueryData(otherCatalogKey, []);

    await act(async () => {
      const row = await result.current.mutateAsync({
        id: "site-1",
        updates: { name_ru: "Левое легкое" },
      });
      expect(row).toEqual(updated);
    });

    expect(builder.update).toHaveBeenCalledWith({ name_ru: "Левое легкое" });
    expect(builder.eq).toHaveBeenCalledWith("id", "site-1");
    expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherCatalogKey)?.isInvalidated).toBe(false);
  });

  it("deletes body site and invalidates list", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDeleteBodySite } = await import("./use-body-site-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteBodySite());
    queryClient.setQueryData(catalogKey, [{ id: "site-1", site_code: "lung" }]);
    queryClient.setQueryData(otherCatalogKey, []);

    await act(async () => {
      await result.current.mutateAsync("site-1");
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "site-1");
    expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherCatalogKey)?.isInvalidated).toBe(false);
  });
});
