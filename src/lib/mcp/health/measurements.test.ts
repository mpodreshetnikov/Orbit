import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { listMeasurements } from "./measurements";

function catalog(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    code: "weight",
    name_ru: "Вес",
    name_en: "Weight",
    unit_ru: "кг",
    unit_en: "kg",
    category: "basic",
    sort_order: 1,
    ...overrides,
  };
}

/**
 * Stubs the PostgREST builder chain. `listMeasurements` orders and optionally
 * ranges, so every builder method returns the builder and the promise resolves
 * at await time.
 */
function supabaseReturning(rows: unknown[]) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return builder;
    };

  const builder = {
    select: record("select"),
    eq: record("eq"),
    gte: record("gte"),
    lte: record("lte"),
    order: record("order"),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  } as unknown as Record<string, unknown> & PromiseLike<unknown>;

  const from = vi.fn().mockReturnValue(builder);
  return { client: { from } as unknown as SupabaseClient<Database>, calls, from };
}

describe("listMeasurements", () => {
  it("groups rows by catalog code and reports the newest value as latest", async () => {
    // Rows arrive newest-first, matching the query's ordering.
    const { client } = supabaseReturning([
      {
        id: "m3",
        catalog_id: "c1",
        value: 78.0,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
      {
        id: "m2",
        catalog_id: "c1",
        value: 79.0,
        measured_at: "2026-02-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
      {
        id: "m1",
        catalog_id: "c1",
        value: 80.0,
        measured_at: "2026-01-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
    ]);

    const [summary] = await listMeasurements(client, { personId: "p-1" });

    expect(summary.code).toBe("weight");
    expect(summary.measurement_count).toBe(3);
    expect(summary.latest_value).toBe(78.0);
    expect(summary.latest_measured_at).toBe("2026-03-01T08:00:00Z");
    // History is oldest-first, which is what charting and trend logic expect.
    expect(summary.history.map((point) => point.value)).toEqual([80.0, 79.0, 78.0]);
    expect(summary.trend).toBe("down");
  });

  it("reports a sub-1% change as flat, matching the app's trend dead zone", async () => {
    // 79.0 -> 78.4 is a 0.76% drop, which the shared helper deliberately treats
    // as no change so noise does not read as a trend.
    const { client } = supabaseReturning([
      {
        id: "m2",
        catalog_id: "c1",
        value: 78.4,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
      {
        id: "m1",
        catalog_id: "c1",
        value: 79.0,
        measured_at: "2026-02-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
    ]);

    const [summary] = await listMeasurements(client, { personId: "p-1" });

    expect(summary.trend).toBe("flat");
  });

  it("reports no trend from a single data point", async () => {
    const { client } = supabaseReturning([
      {
        id: "m1",
        catalog_id: "c1",
        value: 78,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
    ]);

    const [summary] = await listMeasurements(client, { personId: "p-1" });

    expect(summary.trend).toBeNull();
  });

  it("scopes the query to the person", async () => {
    const { client, calls } = supabaseReturning([]);
    await listMeasurements(client, { personId: "p-1" });

    expect(calls.eq).toContainEqual(["person_id", "p-1"]);
  });

  it("applies the range instants it is given without reinterpreting them", async () => {
    const { client, calls } = supabaseReturning([]);
    await listMeasurements(client, {
      personId: "p-1",
      from: "2025-12-31T17:00:00.000Z",
      to: "2026-01-31T16:59:59.999Z",
    });

    // The bounds are the caller's local days already converted to instants, so
    // widening or trimming them here would undo that.
    expect(calls.gte).toContainEqual(["measured_at", "2025-12-31T17:00:00.000Z"]);
    expect(calls.lte).toContainEqual(["measured_at", "2026-01-31T16:59:59.999Z"]);
  });

  it("keeps only the requested codes", async () => {
    const { client } = supabaseReturning([
      {
        id: "m1",
        catalog_id: "c1",
        value: 78,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
      {
        id: "m2",
        catalog_id: "c2",
        value: 90,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog({
          code: "waist",
          name_en: "Waist",
          sort_order: 2,
          category: "body",
        }),
      },
    ]);

    const summaries = await listMeasurements(client, { personId: "p-1", codes: ["waist"] });

    expect(summaries.map((summary) => summary.code)).toEqual(["waist"]);
  });

  it("matches the search term against code and both language names", async () => {
    const rows = [
      {
        id: "m1",
        catalog_id: "c1",
        value: 78,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
      {
        id: "m2",
        catalog_id: "c2",
        value: 90,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog({
          code: "waist",
          name_en: "Waist",
          name_ru: "Талия",
          sort_order: 2,
          category: "body",
        }),
      },
    ];

    for (const [term, expected] of [
      ["weig", ["weight"]],
      ["Талия", ["waist"]],
      ["WAIST", ["waist"]],
    ] as const) {
      const { client } = supabaseReturning(rows);
      const summaries = await listMeasurements(client, { personId: "p-1", search: term });
      expect(summaries.map((summary) => summary.code)).toEqual(expected);
    }
  });

  it("trims history to the requested length, keeping the most recent points", async () => {
    const { client } = supabaseReturning([
      {
        id: "m3",
        catalog_id: "c1",
        value: 78,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
      {
        id: "m2",
        catalog_id: "c1",
        value: 79,
        measured_at: "2026-02-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
      {
        id: "m1",
        catalog_id: "c1",
        value: 80,
        measured_at: "2026-01-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog(),
      },
    ]);

    const [summary] = await listMeasurements(client, { personId: "p-1", historyLimit: 2 });

    expect(summary.history.map((point) => point.value)).toEqual([79, 78]);
    // Count reflects everything on record, not just the returned window.
    expect(summary.measurement_count).toBe(3);
    // Trend is computed over the full history, not the trimmed view.
    expect(summary.trend).toBe("down");
  });

  it("keeps paired limbs adjacent", async () => {
    const { client } = supabaseReturning([
      {
        id: "m1",
        catalog_id: "c1",
        value: 30,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog({
          code: "bicep_right",
          name_en: "Right bicep",
          category: "limbs",
          sort_order: 1,
        }),
      },
      {
        id: "m2",
        catalog_id: "c2",
        value: 40,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog({
          code: "thigh_left",
          name_en: "Left thigh",
          category: "limbs",
          sort_order: 2,
        }),
      },
      {
        id: "m3",
        catalog_id: "c3",
        value: 31,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: catalog({
          code: "bicep_left",
          name_en: "Left bicep",
          category: "limbs",
          sort_order: 1,
        }),
      },
    ]);

    const codes = (await listMeasurements(client, { personId: "p-1" })).map((s) => s.code);

    expect(codes.indexOf("bicep_right") - codes.indexOf("bicep_left")).toBe(1);
  });

  it("skips rows whose catalog entry is missing rather than throwing", async () => {
    const { client } = supabaseReturning([
      {
        id: "m1",
        catalog_id: "c1",
        value: 78,
        measured_at: "2026-03-01T08:00:00Z",
        notes: null,
        measurement_catalog: null,
      },
    ]);

    await expect(listMeasurements(client, { personId: "p-1" })).resolves.toEqual([]);
  });
});
