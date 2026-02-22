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

describe("use-observation-catalog", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("fetches catalog and applies search filter", async () => {
    const rows = [
      {
        id: "obs-1",
        obs_code: "glucose",
        name_ru: "Глюкоза",
        name_en: "Glucose",
        canonical_unit: "mmol/L",
      },
    ];
    const builder = createQueryBuilder({ data: rows, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useObservationCatalog } = await import("./use-observation-catalog");
    const { result } = renderHookWithQueryClient(() => useObservationCatalog("glu"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(builder.order).toHaveBeenCalledWith("obs_code", { ascending: true });
    expect(builder.or).toHaveBeenCalledWith(expect.stringContaining("obs_code.ilike.%glu%"));
  });

  it("returns empty catalog for blank-search responses", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useObservationCatalog } = await import("./use-observation-catalog");
    const { result } = renderHookWithQueryClient(() => useObservationCatalog("   "));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(builder.or).not.toHaveBeenCalled();
  });

  it("returns query error when catalog fetch fails", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "catalog failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useObservationCatalog } = await import("./use-observation-catalog");
    const { result } = renderHookWithQueryClient(() => useObservationCatalog());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("catalog failed");
  });

  it("disables single-observation query without id", async () => {
    const { useObservation } = await import("./use-observation-catalog");
    const { result } = renderHookWithQueryClient(() => useObservation(null));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns null for missing observation", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useObservation } = await import("./use-observation-catalog");
    const { result } = renderHookWithQueryClient(() => useObservation("obs-missing"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(builder.eq).toHaveBeenCalledWith("id", "obs-missing");
  });

  it("returns observation fetch errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { code: "boom", message: "single observation failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useObservation } = await import("./use-observation-catalog");
    const { result } = renderHookWithQueryClient(() => useObservation("obs-1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("single observation failed");
  });

  it("creates observation and invalidates catalog", async () => {
    const created = {
      id: "obs-1",
      obs_code: "glucose",
      name_ru: "Глюкоза",
      name_en: "Glucose",
      canonical_unit: "mmol/L",
      accepted_units: { mmol: { factor_to_canonical: 1 } },
      synonyms_ru: [],
      synonyms_en: [],
      notes: null,
      default_ref_low: 4,
      default_ref_high: 6,
    };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCreateObservation } = await import("./use-observation-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateObservation());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        obs_code: "glucose",
        name_ru: "Глюкоза",
        name_en: "Glucose",
        canonical_unit: "mmol/L",
        accepted_units: { mmol: { factor_to_canonical: 1 } },
        synonyms_ru: [],
        synonyms_en: [],
        notes: null,
        default_ref_low: 4,
        default_ref_high: 6,
      });
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        obs_code: "glucose",
        canonical_unit: "mmol/L",
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["observation-catalog"],
    });
  });

  it("creates observation with defaults and propagates create errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "create observation failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateObservation } = await import("./use-observation-catalog");
    const { result } = renderHookWithQueryClient(() => useCreateObservation());

    await expect(
      result.current.mutateAsync({
        obs_code: "hb",
        name_ru: "HB",
        name_en: "Hemoglobin",
        canonical_unit: "g/L",
      }),
    ).rejects.toThrow("create observation failed");
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        synonyms_ru: [],
        synonyms_en: [],
        accepted_units: {},
        notes: null,
        default_ref_low: null,
        default_ref_high: null,
      }),
    );
  });

  it("updates observation and invalidates list + detail", async () => {
    const updated = {
      id: "obs-1",
      obs_code: "glucose",
      name_ru: "Глюкоза",
      name_en: "Serum glucose",
      canonical_unit: "mmol/L",
    };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useUpdateObservation } = await import("./use-observation-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateObservation());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "obs-1",
        updates: {
          name_en: "Serum glucose",
          accepted_units: { mmol: { factor_to_canonical: 1 } },
        },
      });
    });

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ name_en: "Serum glucose" }),
    );
    expect(builder.eq).toHaveBeenCalledWith("id", "obs-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["observation-catalog"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["observation", "obs-1"],
    });
  });

  it("updates observation without accepted_units and propagates update errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "update observation failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useUpdateObservation } = await import("./use-observation-catalog");
    const { result } = renderHookWithQueryClient(() => useUpdateObservation());

    await expect(
      result.current.mutateAsync({
        id: "obs-1",
        updates: { name_en: "Updated" },
      }),
    ).rejects.toThrow("update observation failed");
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted_units: undefined,
      }),
    );
  });

  it("deletes observation and invalidates catalog", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDeleteObservation } = await import("./use-observation-catalog");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteObservation());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync("obs-1");
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "obs-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["observation-catalog"],
    });
  });

  it("propagates delete observation errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "delete observation failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteObservation } = await import("./use-observation-catalog");
    const { result } = renderHookWithQueryClient(() => useDeleteObservation());

    await expect(result.current.mutateAsync("obs-1")).rejects.toThrow("delete observation failed");
  });
});
