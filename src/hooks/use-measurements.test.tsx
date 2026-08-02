import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateMeasurementInput, UpdateMeasurementInput } from "@/types";
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

function measurementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    person_id: "p1",
    catalog_id: "cat-1",
    value: 80,
    measured_at: "2026-01-02T00:00:00.000Z",
    notes: null,
    created_by_user_id: "user-1",
    created_at: "2026-01-02T00:00:00.000Z",
    measurement_catalog: {
      code: "weight",
      name_ru: "Вес",
      name_en: "Weight",
      unit_ru: "кг",
      unit_en: "kg",
      category: "unknown-category",
      sort_order: 1,
    },
    ...overrides,
  };
}

describe("use-measurements", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("aggregates person measurements and applies search", async () => {
    const builder = createQueryBuilder({
      data: [
        measurementRow({
          id: "m-1",
          value: 80,
          measured_at: "2026-01-02T00:00:00.000Z",
        }),
        measurementRow({
          id: "m-2",
          value: 79,
          measured_at: "2026-01-01T00:00:00.000Z",
        }),
        measurementRow({
          id: "m-3",
          catalog_id: "cat-2",
          measurement_catalog: {
            code: "pulse",
            name_ru: "Пульс",
            name_en: "Pulse",
            unit_ru: "уд/мин",
            unit_en: "bpm",
            category: "vital",
            sort_order: 2,
          },
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { usePersonMeasurements } = await import("./use-measurements");
    const { result } = renderHookWithQueryClient(() => usePersonMeasurements("p1", "weight"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toEqual(
      expect.objectContaining({
        code: "weight",
        measurement_count: 2,
        category: "basic",
      }),
    );
    expect(result.current.data?.[0].history.map((h) => h.id)).toEqual(["m-2", "m-1"]);
  });

  it("orders left/right pairs together using the catalog sort_order", async () => {
    const limb = (code: string, name_en: string, sort_order: number) => ({
      code,
      name_ru: name_en,
      name_en,
      unit_ru: "см",
      unit_en: "cm",
      category: "limbs",
      sort_order,
    });

    // Fed in scrambled; sorting by name alone would put every "Left ..." first.
    const builder = createQueryBuilder({
      data: [
        measurementRow({
          id: "m-1",
          catalog_id: "cat-calf-l",
          measurement_catalog: limb("calf_left", "Left calf", 7),
        }),
        measurementRow({
          id: "m-2",
          catalog_id: "cat-bicep-r",
          measurement_catalog: limb("bicep_right", "Right bicep", 2),
        }),
        measurementRow({
          id: "m-3",
          catalog_id: "cat-bicep-l",
          measurement_catalog: limb("bicep_left", "Left bicep", 1),
        }),
        measurementRow({
          id: "m-4",
          catalog_id: "cat-calf-r",
          measurement_catalog: limb("calf_right", "Right calf", 8),
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { usePersonMeasurements } = await import("./use-measurements");
    const { result } = renderHookWithQueryClient(() => usePersonMeasurements("p1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((m) => m.code)).toEqual([
      "bicep_left",
      "bicep_right",
      "calf_left",
      "calf_right",
    ]);
    expect(result.current.data?.[0].sort_order).toBe(1);
  });

  it("returns empty list when no measurements exist", async () => {
    const builder = createQueryBuilder({
      data: [],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { usePersonMeasurements } = await import("./use-measurements");
    const { result } = renderHookWithQueryClient(() => usePersonMeasurements("p1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("returns null for missing measurement catalog code", async () => {
    const catalogBuilder = createQueryBuilder({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => catalogBuilder),
    });

    const { useSingleMeasurementHistory } = await import("./use-measurements");
    const { result } = renderHookWithQueryClient(() =>
      useSingleMeasurementHistory("p1", "unknown-code"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("returns empty history shell when catalog exists but has no rows", async () => {
    const catalogBuilder = createQueryBuilder({
      data: {
        id: "cat-1",
        code: "weight",
        name_ru: "Вес",
        name_en: "Weight",
        unit_ru: "кг",
        unit_en: "kg",
        category: "body",
      },
      error: null,
    });
    const rowsBuilder = createQueryBuilder({
      data: [],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "measurement_catalog" ? catalogBuilder : rowsBuilder,
      ),
    });

    const { useSingleMeasurementHistory } = await import("./use-measurements");
    const { result } = renderHookWithQueryClient(() => useSingleMeasurementHistory("p1", "weight"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(
      expect.objectContaining({
        code: "weight",
        measurement_count: 0,
        history: [],
      }),
    );
  });

  it("creates measurement and invalidates person queries", async () => {
    const created = {
      id: "m-1",
      person_id: "p1",
      catalog_id: "cat-1",
      value: 80,
    };
    const builder = createQueryBuilder({
      data: created,
      error: null,
    });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: vi.fn(() => builder),
    });

    const { useCreateMeasurement } = await import("./use-measurements");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateMeasurement());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        person_id: "p1",
        catalog_id: "cat-1",
        value: 80,
      } as CreateMeasurementInput);
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        person_id: "p1",
        catalog_id: "cat-1",
        created_by_user_id: "user-1",
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["person-measurements", "p1"],
    });
  });

  it("updates measurement and invalidates queries", async () => {
    const updated = {
      id: "m-1",
      person_id: "p1",
      catalog_id: "cat-1",
      value: 79,
    };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useUpdateMeasurement } = await import("./use-measurements");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateMeasurement());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "m-1",
        personId: "p1",
        updates: { value: 79 },
      } as { id: string; personId: string; updates: UpdateMeasurementInput });
    });

    expect(builder.update).toHaveBeenCalledWith({ value: 79 });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["person-measurements", "p1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["single-measurement-history", "p1"],
    });
  });

  it("deletes measurement and invalidates queries", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDeleteMeasurement } = await import("./use-measurements");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteMeasurement());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "m-1",
        personId: "p1",
      });
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "m-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["person-measurements", "p1"],
    });
  });
});
