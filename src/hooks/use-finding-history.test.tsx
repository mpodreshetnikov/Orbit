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

function findingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "f-1",
    record_id: "r-1",
    finding_type_id: "ft-1",
    finding_code: "nodule",
    finding_type_text: "Nodule",
    body_site_id: "site-1",
    site_code: "lung",
    body_site_text: "Lung",
    size_mm: 4,
    count: 1,
    severity: "mild",
    laterality: "left",
    morphology: null,
    description: null,
    histology: null,
    source_anchor: "line",
    created_at: "2026-01-01T00:00:00.000Z",
    medical_records: {
      person_id: "person-1",
      record_date: "2026-01-01",
      status: "active",
    },
    finding_type_catalog: {
      name_ru: "Узел",
      name_en: "Nodule",
    },
    body_site_catalog: {
      name_ru: "Легкое",
      name_en: "Lung",
    },
    ...overrides,
  };
}

describe("use-finding-history", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("aggregates person finding history and applies search", async () => {
    const builder = createQueryBuilder({
      data: [
        findingRow({
          id: "f-1",
          record_id: "r-1",
          size_mm: 4,
          created_at: "2026-01-02T00:00:00.000Z",
        }),
        findingRow({
          id: "f-2",
          record_id: "r-2",
          size_mm: 2,
          created_at: "2026-01-01T00:00:00.000Z",
        }),
        findingRow({
          id: "f-3",
          finding_code: "cyst",
          finding_type_text: "Cyst",
          site_code: "liver",
          body_site_text: "Liver",
          severity: "severe",
          finding_type_catalog: {
            name_ru: "Киста",
            name_en: "Cyst",
          },
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { usePersonFindingHistory } = await import("./use-finding-history");
    const { result } = renderHookWithQueryClient(() => usePersonFindingHistory("person-1", "nod"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toEqual(
      expect.objectContaining({
        finding_code: "nodule",
        occurrence_count: 2,
      }),
    );
  });

  it("returns null when single finding is missing", async () => {
    const builder = createQueryBuilder({
      data: [],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useSingleFindingHistory } = await import("./use-finding-history");
    const { result } = renderHookWithQueryClient(() =>
      useSingleFindingHistory("person-1", "unknown"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("marks finding as resolved and invalidates related queries", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useMarkFindingResolved } = await import("./use-finding-history");
    const { result, queryClient } = renderHookWithQueryClient(() => useMarkFindingResolved());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        personId: "person-1",
        recordId: "record-1",
        finding: {
          finding_type_id: "ft-1",
          finding_code: "nodule",
          finding_type_text: "Nodule",
          body_site_id: "site-1",
          site_code: "lung",
          body_site_text: "Lung",
          latest_laterality: "left",
        },
      } as import("./use-finding-history").MarkResolvedInput);
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        size_mm: 0,
        count: 0,
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["person-finding-history", "person-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-findings", "record-1"],
    });
  });

  it("sorts severe findings first and falls back to older size/count values", async () => {
    const builder = createQueryBuilder({
      data: [
        findingRow({
          id: "nodule-latest",
          finding_code: "nodule",
          finding_type_text: "Nodule",
          site_code: "lung",
          body_site_text: "Lung",
          severity: "mild",
          size_mm: null,
          count: null,
          created_at: "2026-01-03T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: "2026-01-03", status: "active" },
        }),
        findingRow({
          id: "nodule-older",
          finding_code: "nodule",
          finding_type_text: "Nodule",
          site_code: "lung",
          body_site_text: "Lung",
          severity: "mild",
          size_mm: 5,
          count: 2,
          created_at: "2026-01-01T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: "2026-01-01", status: "active" },
        }),
        findingRow({
          id: "severe-one",
          finding_code: "cyst",
          finding_type_text: "Cyst",
          site_code: "liver",
          body_site_text: "Liver",
          severity: "severe",
          size_mm: 7,
          count: 1,
          created_at: "2026-01-02T00:00:00.000Z",
          medical_records: { person_id: "person-1", record_date: "2026-01-02", status: "active" },
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { usePersonFindingHistory } = await import("./use-finding-history");
    const { result } = renderHookWithQueryClient(() => usePersonFindingHistory("person-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]).toEqual(
      expect.objectContaining({
        finding_code: "cyst",
        latest_severity: "severe",
      }),
    );
    const nodule = result.current.data?.find((f) => f.finding_code === "nodule");
    expect(nodule).toEqual(
      expect.objectContaining({
        latest_size_mm: 5,
        latest_count: 2,
        occurrence_count: 2,
      }),
    );
  });

  it("supports search by site/catalog and single finding lookup by site code", async () => {
    const builder = createQueryBuilder({
      data: [
        findingRow({
          id: "liver-1",
          finding_code: "cyst",
          finding_type_text: "Cyst",
          site_code: "liver",
          body_site_text: "Liver",
          finding_type_catalog: { name_ru: "Киста", name_en: "Cyst" },
          body_site_catalog: { name_ru: "Печень", name_en: "Liver" },
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { usePersonFindingHistory, useSingleFindingHistory } =
      await import("./use-finding-history");
    const bySearch = renderHookWithQueryClient(() => usePersonFindingHistory("person-1", "liver"));
    const single = renderHookWithQueryClient(() =>
      useSingleFindingHistory("person-1", "cyst", "liver"),
    );

    await waitFor(() => expect(bySearch.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(single.result.current.isSuccess).toBe(true));
    expect(bySearch.result.current.data).toHaveLength(1);
    expect(single.result.current.data).toEqual(
      expect.objectContaining({
        finding_code: "cyst",
        site_code: "liver",
      }),
    );
    expect(builder.or).toHaveBeenCalledWith("site_code.eq.liver,body_site_text.ilike.liver");
  });

  it("returns errors for failing queries and keeps disabled hooks idle", async () => {
    const fromMock = vi.fn(() =>
      createQueryBuilder({
        data: null,
        error: { message: "finding query failed" },
      }),
    );
    createClientMock.mockReturnValue({ from: fromMock });

    const { usePersonFindingHistory, useSingleFindingHistory } =
      await import("./use-finding-history");
    const personError = renderHookWithQueryClient(() => usePersonFindingHistory("person-1", "x"));
    const singleError = renderHookWithQueryClient(() =>
      useSingleFindingHistory("person-1", "x", "site"),
    );
    const disabledPerson = renderHookWithQueryClient(() => usePersonFindingHistory(null, "x"));
    const disabledSingle = renderHookWithQueryClient(() => useSingleFindingHistory(null, null));

    await waitFor(() => expect(personError.result.current.isError).toBe(true));
    await waitFor(() => expect(singleError.result.current.isError).toBe(true));
    expect((personError.result.current.error as Error).message).toBe("finding query failed");
    expect((singleError.result.current.error as Error).message).toBe("finding query failed");
    expect(disabledPerson.result.current.fetchStatus).toBe("idle");
    expect(disabledSingle.result.current.fetchStatus).toBe("idle");
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it("propagates mark resolved insert errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "insert failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMarkFindingResolved } = await import("./use-finding-history");
    const { result } = renderHookWithQueryClient(() => useMarkFindingResolved());

    await expect(
      result.current.mutateAsync({
        personId: "person-1",
        recordId: "record-1",
        finding: {
          finding_type_id: "ft-1",
          finding_code: "nodule",
          finding_type_text: "Nodule",
          body_site_id: "site-1",
          site_code: "lung",
          body_site_text: "Lung",
          latest_laterality: "left",
        },
      } as import("./use-finding-history").MarkResolvedInput),
    ).rejects.toThrow("insert failed");
  });

  it("returns empty person history when no finding rows exist", async () => {
    const builder = createQueryBuilder({
      data: [],
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { usePersonFindingHistory } = await import("./use-finding-history");
    const { result } = renderHookWithQueryClient(() => usePersonFindingHistory("person-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("covers fallback grouping/sorting and search matching across all searchable fields", async () => {
    const rows = [
      findingRow({
        id: "fallback-1",
        finding_code: null,
        finding_type_text: "Fallback Type",
        site_code: null,
        body_site_text: null,
        size_mm: null,
        count: null,
        severity: "moderate",
        created_at: "2026-01-01T00:00:00.000Z",
        medical_records: { person_id: "person-1", record_date: null, status: "active" },
        finding_type_catalog: null,
        body_site_catalog: null,
      }),
      findingRow({
        id: "code-search",
        finding_code: "code-1",
        finding_type_text: "Code Search Type",
        site_code: "site-1",
        body_site_text: "Chest",
        severity: "moderate",
        created_at: "2026-02-01T00:00:00.000Z",
        medical_records: { person_id: "person-1", record_date: null, status: "active" },
        finding_type_catalog: { name_ru: "catalog-ru", name_en: "catalog-en" },
        body_site_catalog: { name_ru: "site-ru", name_en: "site-en" },
      }),
    ];
    createClientMock.mockReturnValue({
      from: vi.fn(() => createQueryBuilder({ data: rows, error: null })),
    });

    const { usePersonFindingHistory, useSingleFindingHistory } =
      await import("./use-finding-history");

    const base = renderHookWithQueryClient(() => usePersonFindingHistory("person-1"));
    const byCode = renderHookWithQueryClient(() => usePersonFindingHistory("person-1", "code-1"));
    const bySiteCode = renderHookWithQueryClient(() =>
      usePersonFindingHistory("person-1", "site-1"),
    );
    const byCatalogRu = renderHookWithQueryClient(() =>
      usePersonFindingHistory("person-1", "catalog-ru"),
    );
    const byCatalogEn = renderHookWithQueryClient(() =>
      usePersonFindingHistory("person-1", "catalog-en"),
    );
    const bySiteRu = renderHookWithQueryClient(() =>
      usePersonFindingHistory("person-1", "site-ru"),
    );
    const bySiteEn = renderHookWithQueryClient(() =>
      usePersonFindingHistory("person-1", "site-en"),
    );
    const singleFallback = renderHookWithQueryClient(() =>
      useSingleFindingHistory("person-1", "fallback type", "unknown"),
    );

    await waitFor(() => expect(base.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(byCode.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(bySiteCode.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(byCatalogRu.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(byCatalogEn.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(bySiteRu.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(bySiteEn.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(singleFallback.result.current.isSuccess).toBe(true));

    expect(base.result.current.data?.some((row) => row.finding_code === "code-1")).toBe(true);
    expect(byCode.result.current.data).toHaveLength(1);
    expect(bySiteCode.result.current.data).toHaveLength(1);
    expect(byCatalogRu.result.current.data).toHaveLength(1);
    expect(byCatalogEn.result.current.data).toHaveLength(1);
    expect(bySiteRu.result.current.data).toHaveLength(1);
    expect(bySiteEn.result.current.data).toHaveLength(1);
    expect(singleFallback.result.current.data).toEqual(
      expect.objectContaining({
        catalog_finding_name_ru: null,
        catalog_finding_name_en: null,
        catalog_site_name_ru: null,
        catalog_site_name_en: null,
      }),
    );
  });
});
