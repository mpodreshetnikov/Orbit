import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
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

function observationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o-1",
    record_id: "r-1",
    obs_code: "glucose",
    obs_name: "Glucose",
    catalog_id: "catalog-1",
    value_numeric: 5.1,
    value_text: null,
    value_canonical: 5.1,
    unit: "mmol/L",
    unit_canonical: "mmol/L",
    ref_range_low: 4,
    ref_range_high: 6,
    ref_range_low_canonical: 4,
    ref_range_high_canonical: 6,
    status: "normal",
    created_at: "2026-01-02T00:00:00.000Z",
    medical_records: {
      person_id: "person-1",
      record_date: "2026-01-02",
      status: "active",
    },
    observation_catalog: {
      name_ru: "Глюкоза",
      name_en: "Glucose",
      canonical_unit: "mmol/L",
      synonyms_ru: [],
      synonyms_en: [],
      default_ref_low: 4,
      default_ref_high: 6,
    },
    ...overrides,
  };
}

describe("use-observation-history", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("aggregates person observation history and applies search", async () => {
    const builder = createQueryBuilder({
      data: [
        observationRow({ id: "o-1", value_canonical: 5.2, created_at: "2026-01-02T00:00:00.000Z" }),
        observationRow({
          id: "o-2",
          value_canonical: 5.0,
          created_at: "2026-01-01T00:00:00.000Z",
          medical_records: {
            person_id: "person-1",
            record_date: "2026-01-01",
            status: "active",
          },
        }),
        observationRow({
          id: "o-3",
          obs_code: "hemoglobin",
          obs_name: "Hemoglobin",
          observation_catalog: {
            name_ru: "Гемоглобин",
            name_en: "Hemoglobin",
            canonical_unit: "g/L",
            default_ref_low: 120,
            default_ref_high: 160,
          },
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { usePersonObservationHistory } = await import("./use-observation-history");
    const { result } = renderHookWithQueryClient(() =>
      usePersonObservationHistory("person-1", "glu"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toEqual(
      expect.objectContaining({
        obs_code: "glucose",
        measurement_count: 2,
      }),
    );
    expect(result.current.data?.[0].history.map((h) => h.id)).toEqual(["o-2", "o-1"]);
  });

  it("returns null when single observation history is missing", async () => {
    const builder = createQueryBuilder({
      data: [],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useSingleObservationHistory } = await import("./use-observation-history");
    const { result } = renderHookWithQueryClient(() =>
      useSingleObservationHistory("person-1", "unknown"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("returns single observation summary with oldest-first chart history", async () => {
    const builder = createQueryBuilder({
      data: [
        observationRow({
          id: "o-new",
          created_at: "2026-01-02T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: "2026-01-02", status: "active" },
        }),
        observationRow({
          id: "o-old",
          created_at: "2026-01-01T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: "2026-01-01", status: "active" },
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useSingleObservationHistory } = await import("./use-observation-history");
    const { result } = renderHookWithQueryClient(() =>
      useSingleObservationHistory("person-1", "glucose"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.history.map((h) => h.id)).toEqual(["o-old", "o-new"]);
    expect(result.current.data?.obs_code).toBe("glucose");
  });

  it("groups custom observations and sorts abnormal summaries first", async () => {
    const builder = createQueryBuilder({
      data: [
        observationRow({
          id: "custom-new",
          obs_code: null,
          obs_name: "Custom Marker",
          status: "normal",
          created_at: "2026-01-03T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: null, status: "active" },
        }),
        observationRow({
          id: "custom-old",
          obs_code: null,
          obs_name: "Custom Marker",
          status: "normal",
          created_at: "2026-01-01T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: null, status: "active" },
        }),
        observationRow({
          id: "high-1",
          obs_code: "wbc",
          obs_name: "Leukocytes",
          status: "high",
          created_at: "2026-01-02T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: "2026-01-02", status: "active" },
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { usePersonObservationHistory } = await import("./use-observation-history");
    const { result } = renderHookWithQueryClient(() => usePersonObservationHistory("person-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]).toEqual(
      expect.objectContaining({
        obs_code: "wbc",
        latest_status: "high",
      }),
    );
    expect(result.current.data?.[1]).toEqual(
      expect.objectContaining({
        obs_name: "Custom Marker",
        measurement_count: 2,
      }),
    );
  });

  it("supports search by catalog names and returns empty when no matches", async () => {
    const builder = createQueryBuilder({
      data: [
        observationRow({
          id: "cat-1",
          obs_code: "alt",
          obs_name: "ALT",
          observation_catalog: {
            name_ru: "Аланинаминотрансфераза",
            name_en: "Alanine aminotransferase",
            canonical_unit: "U/L",
            default_ref_low: 0,
            default_ref_high: 40,
          },
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { usePersonObservationHistory } = await import("./use-observation-history");
    const byCatalogName = renderHookWithQueryClient(() =>
      usePersonObservationHistory("person-1", "alanine"),
    );
    const noMatch = renderHookWithQueryClient(() =>
      usePersonObservationHistory("person-1", "does-not-exist"),
    );

    await waitFor(() => expect(byCatalogName.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(noMatch.result.current.isSuccess).toBe(true));
    expect(byCatalogName.result.current.data).toHaveLength(1);
    expect(noMatch.result.current.data).toEqual([]);
  });

  it("returns fetch errors and respects disabled queries", async () => {
    const fromMock = vi.fn(() =>
      createQueryBuilder({
        data: null,
        error: { message: "observation query failed" },
      }),
    );
    createClientMock.mockReturnValue({ from: fromMock });

    const { usePersonObservationHistory, useSingleObservationHistory } =
      await import("./use-observation-history");

    const personError = renderHookWithQueryClient(() =>
      usePersonObservationHistory("person-1", "x"),
    );
    const singleError = renderHookWithQueryClient(() =>
      useSingleObservationHistory("person-1", "x"),
    );
    const disabledPerson = renderHookWithQueryClient(() => usePersonObservationHistory(null, "x"));
    const disabledSingle = renderHookWithQueryClient(() => useSingleObservationHistory(null, null));

    await waitFor(() => expect(personError.result.current.isError).toBe(true));
    await waitFor(() => expect(singleError.result.current.isError).toBe(true));
    expect((personError.result.current.error as Error).message).toBe("observation query failed");
    expect((singleError.result.current.error as Error).message).toBe("observation query failed");
    expect(disabledPerson.result.current.fetchStatus).toBe("idle");
    expect(disabledSingle.result.current.fetchStatus).toBe("idle");
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it("builds single observation summary using fallbacks", async () => {
    const builder = createQueryBuilder({
      data: [
        observationRow({
          id: "fallback-new",
          obs_code: null,
          obs_name: "Fallback Name",
          value_canonical: null,
          value_numeric: 7.7,
          unit_canonical: null,
          unit: "mg/dL",
          created_at: "2026-01-03T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: null, status: "active" },
          observation_catalog: null,
        }),
        observationRow({
          id: "fallback-old",
          obs_code: null,
          obs_name: "Fallback Name",
          value_canonical: null,
          value_numeric: 6.6,
          unit_canonical: null,
          unit: "mg/dL",
          created_at: "2026-01-01T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: null, status: "active" },
          observation_catalog: null,
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useSingleObservationHistory } = await import("./use-observation-history");
    const { result } = renderHookWithQueryClient(() =>
      useSingleObservationHistory("person-1", "fallback-code"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(
      expect.objectContaining({
        obs_code: "fallback-code",
        latest_value: 7.7,
        latest_unit: "mg/dL",
        canonical_unit: null,
        default_ref_low: null,
        default_ref_high: null,
        measurement_count: 2,
      }),
    );
    expect(result.current.data?.history.map((h) => h.id)).toEqual(["fallback-old", "fallback-new"]);
  });
});
