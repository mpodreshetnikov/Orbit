import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyCategory } from "@/types";
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

describe("use-money-categories", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("sorts categories by depth then english name", async () => {
    const { sortMoneyCategories } = await import("./use-money-categories");
    const sorted = sortMoneyCategories([
      { id: "3", depth: 1, name_en: "Zoo" },
      { id: "2", depth: 0, name_en: "Food" },
      { id: "1", depth: 1, name_en: "Auto" },
    ] as MoneyCategory[]);

    expect(sorted.map((c) => c.id)).toEqual(["2", "1", "3"]);
  });

  it("builds and flattens category tree", async () => {
    const { buildMoneyCategoryTree, flattenMoneyCategoryTree } =
      await import("./use-money-categories");
    const tree = buildMoneyCategoryTree([
      { id: "root", parent_id: null, depth: 0, name_en: "Root" },
      { id: "child-b", parent_id: "root", depth: 1, name_en: "B" },
      { id: "child-a", parent_id: "root", depth: 1, name_en: "A" },
    ] as MoneyCategory[]);

    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.id)).toEqual(["child-a", "child-b"]);
    expect(flattenMoneyCategoryTree(tree).map((c) => c.id)).toEqual(["root", "child-a", "child-b"]);
  });

  it("loads categories", async () => {
    const data = [
      {
        id: "cat-1",
        parent_id: null,
        depth: 0,
        name_ru: "Еда",
        name_en: "Food",
        slug: "food",
      },
    ];
    const builder = createQueryBuilder({ data, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyCategories } = await import("./use-money-categories");
    const { result } = renderHookWithQueryClient(() => useMoneyCategories());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(builder.order).toHaveBeenCalledWith("depth", { ascending: true });
    expect(builder.order).toHaveBeenCalledWith("name_en", { ascending: true });
  });

  it("returns query error", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "categories failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyCategories } = await import("./use-money-categories");
    const { result } = renderHookWithQueryClient(() => useMoneyCategories());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("categories failed");
  });

  it("creates category and invalidates list", async () => {
    const created = {
      id: "cat-1",
      parent_id: null,
      depth: 0,
      name_ru: "Еда",
      name_en: "Food",
      slug: "food",
    };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateMoneyCategory } = await import("./use-money-categories");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateMoneyCategory());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        parent_id: null,
        depth: 0,
        name_ru: "Еда",
        name_en: "Food",
        slug: "food",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-categories"] });
  });

  it("updates category and invalidates list", async () => {
    const updated = {
      id: "cat-1",
      parent_id: null,
      depth: 0,
      name_ru: "Питание",
      name_en: "Food",
      slug: "food",
    };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useUpdateMoneyCategory } = await import("./use-money-categories");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateMoneyCategory());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "cat-1",
        updates: { name_ru: "Питание" },
      });
    });

    expect(builder.update).toHaveBeenCalledWith({ name_ru: "Питание" });
    expect(builder.eq).toHaveBeenCalledWith("id", "cat-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-categories"] });
  });

  it("deletes category and invalidates list", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteMoneyCategory } = await import("./use-money-categories");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteMoneyCategory());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync("cat-1");
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "cat-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-categories"] });
  });
});
