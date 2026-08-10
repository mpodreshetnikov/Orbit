import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getObservationHistory, searchObservations } from "./observations";

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
    or: record("or"),
    gte: record("gte"),
    lte: record("lte"),
    order: record("order"),
    limit: record("limit"),
    range: record("range"),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  } as unknown as Record<string, unknown> & PromiseLike<unknown>;

  return {
    client: { from: vi.fn().mockReturnValue(builder) } as unknown as SupabaseClient<Database>,
    calls,
  };
}

function observationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o-1",
    record_id: "r-1",
    obs_code: "ferritin",
    obs_name: "Ferritin",
    value_numeric: 42,
    value_text: null,
    unit: "ng/mL",
    value_canonical: 42,
    unit_canonical: "ng/mL",
    ref_range_low: 30,
    ref_range_high: 400,
    ref_range_text: null,
    status: "normal",
    is_user_verified: true,
    medical_records: { person_id: "p-1", record_date: "2026-02-01", title: "Blood panel" },
    ...overrides,
  };
}

describe("searchObservations", () => {
  it("reaches the person through the parent record, since the table has no person_id", async () => {
    const { client, calls } = supabaseReturning([]);
    await searchObservations(client, { personId: "p-1", limit: 20, offset: 0 });

    // The inner-join embed is what makes this filter possible at all.
    expect(calls.select[0][0]).toContain("medical_records!inner");
    expect(calls.eq).toContainEqual(["medical_records.person_id", "p-1"]);
  });

  it("only counts applied observations from active records", async () => {
    const { client, calls } = supabaseReturning([]);
    await searchObservations(client, { personId: "p-1", limit: 20, offset: 0 });

    // Unreviewed pipeline output and superseded extractions are not history.
    expect(calls.eq).toContainEqual(["medical_records.status", "active"]);
    expect(calls.eq).toContainEqual(["is_applied", true]);
  });

  it("flattens the joined record fields onto each observation", async () => {
    const { client } = supabaseReturning([observationRow()]);
    const [observation] = await searchObservations(client, {
      personId: "p-1",
      limit: 20,
      offset: 0,
    });

    expect(observation.record_date).toBe("2026-02-01");
    expect(observation.record_title).toBe("Blood panel");
    expect(observation).not.toHaveProperty("medical_records");
  });

  it("neutralizes PostgREST filter delimiters in the search text", async () => {
    const { client, calls } = supabaseReturning([]);
    await searchObservations(client, {
      personId: "p-1",
      // A raw comma or paren here would otherwise change the meaning of the
      // `or` expression rather than being searched for.
      query: "iron,(low)",
      limit: 20,
      offset: 0,
    });

    const filter = calls.or[0][0] as string;
    expect(filter).toBe("obs_name.ilike.%iron  low %,obs_code.ilike.%iron  low %");
  });

  it("pages with an inclusive range", async () => {
    const { client, calls } = supabaseReturning([]);
    await searchObservations(client, { personId: "p-1", limit: 20, offset: 40 });

    expect(calls.range).toContainEqual([40, 59]);
  });

  it("passes through the status filter for out-of-range questions", async () => {
    const { client, calls } = supabaseReturning([]);
    await searchObservations(client, { personId: "p-1", status: "high", limit: 20, offset: 0 });

    expect(calls.eq).toContainEqual(["status", "high"]);
  });
});

describe("getObservationHistory", () => {
  it("returns the series oldest first, whatever order the rows arrive in", async () => {
    const { client } = supabaseReturning([
      observationRow({
        id: "o-2",
        value_numeric: 55,
        medical_records: { person_id: "p-1", record_date: "2026-05-01", title: "B" },
      }),
      observationRow({
        id: "o-1",
        value_numeric: 42,
        medical_records: { person_id: "p-1", record_date: "2026-02-01", title: "A" },
      }),
      observationRow({
        id: "o-3",
        value_numeric: 61,
        medical_records: { person_id: "p-1", record_date: "2026-08-01", title: "C" },
      }),
    ]);

    const history = await getObservationHistory(client, {
      personId: "p-1",
      obsCode: "ferritin",
      limit: 50,
    });

    expect(history.map((row) => row.record_date)).toEqual([
      "2026-02-01",
      "2026-05-01",
      "2026-08-01",
    ]);
  });

  it("filters to the requested analyte", async () => {
    const { client, calls } = supabaseReturning([]);
    await getObservationHistory(client, { personId: "p-1", obsCode: "ferritin", limit: 50 });

    expect(calls.eq).toContainEqual(["obs_code", "ferritin"]);
  });
});
