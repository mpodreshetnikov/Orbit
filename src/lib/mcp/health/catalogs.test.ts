import { describe, expect, it } from "vitest";
import {
  CATALOG_SPECS,
  getCatalogSpec,
  listCatalogEntries,
  searchCatalogEntries,
  upsertCatalogEntry,
  type CatalogKind,
} from "./catalogs";
import { createSupabaseStub } from "./test-support";

const KINDS: CatalogKind[] = ["observation", "measurement", "finding_type", "body_site"];

describe("catalog specs", () => {
  it.each(KINDS)("maps %s to its table and natural key", (kind) => {
    const spec = getCatalogSpec(kind);
    expect(spec.table).toBe(CATALOG_SPECS[kind].table);
    expect(spec.columns).toContain(spec.codeColumn);
    expect(spec.label).toBeTruthy();
  });

  it("marks measurement_catalog as having no synonym columns", () => {
    // The other three have synonyms_ru/synonyms_en; referencing them on this
    // table would make the query error.
    expect(getCatalogSpec("measurement").hasSynonyms).toBe(false);
    expect(getCatalogSpec("observation").hasSynonyms).toBe(true);
    expect(getCatalogSpec("finding_type").hasSynonyms).toBe(true);
    expect(getCatalogSpec("body_site").hasSynonyms).toBe(true);
  });
});

describe("listCatalogEntries", () => {
  it.each(KINDS)("queries the %s table ordered by its code column", async (kind) => {
    const spec = getCatalogSpec(kind);
    const stub = createSupabaseStub({ [spec.table]: [{ data: [] }] });

    await listCatalogEntries(stub.client, { kind, limit: 20, offset: 0 });

    expect(stub.argsFor(spec.table, "order")).toEqual([[spec.codeColumn, { ascending: true }]]);
    expect(stub.argsFor(spec.table, "range")).toEqual([[0, 19]]);
  });

  it("applies a category filter only for the measurement catalog", async () => {
    const stub = createSupabaseStub({ measurement_catalog: [{ data: [] }] });
    await listCatalogEntries(stub.client, {
      kind: "measurement",
      limit: 20,
      offset: 0,
      category: "limbs",
    });

    expect(stub.argsFor("measurement_catalog", "eq")).toEqual([["category", "limbs"]]);
  });

  it("ignores a category on catalogs that have no such column", async () => {
    const stub = createSupabaseStub({ observation_catalog: [{ data: [] }] });
    await listCatalogEntries(stub.client, {
      kind: "observation",
      limit: 20,
      offset: 0,
      category: "limbs",
    });

    expect(stub.argsFor("observation_catalog", "eq")).toHaveLength(0);
  });

  it("returns an empty list rather than null", async () => {
    const stub = createSupabaseStub({ body_site_catalog: [{ data: null }] });
    await expect(
      listCatalogEntries(stub.client, { kind: "body_site", limit: 5, offset: 0 }),
    ).resolves.toEqual([]);
  });

  it("surfaces a query error naming the catalog", async () => {
    const stub = createSupabaseStub({ observation_catalog: [{ error: { message: "boom" } }] });
    await expect(
      listCatalogEntries(stub.client, { kind: "observation", limit: 5, offset: 0 }),
    ).rejects.toThrow(/Failed to list lab analyte types: boom/);
  });
});

describe("searchCatalogEntries", () => {
  it("matches code and both language names", async () => {
    const stub = createSupabaseStub({
      measurement_catalog: [{ data: [{ id: "1", code: "weight" }] }],
    });

    await searchCatalogEntries(stub.client, { kind: "measurement", query: "weig", limit: 10 });

    const [[filter]] = stub.argsFor("measurement_catalog", "or");
    expect(filter).toBe("code.ilike.%weig%,name_en.ilike.%weig%,name_ru.ilike.%weig%");
  });

  it("does not run a second synonym pass on a catalog without synonyms", async () => {
    const stub = createSupabaseStub({ measurement_catalog: [{ data: [{ id: "1" }] }] });
    await searchCatalogEntries(stub.client, { kind: "measurement", query: "x", limit: 10 });

    // One query only; a synonym scan would reference columns that do not exist.
    expect(stub.argsFor("measurement_catalog", "select")).toHaveLength(1);
  });

  it("merges synonym matches that the ilike pass missed", async () => {
    const stub = createSupabaseStub({
      observation_catalog: [
        { data: [{ id: "1", obs_code: "ferritin" }] },
        {
          data: [
            { id: "1", obs_code: "ferritin", synonyms_en: [] },
            { id: "2", obs_code: "hgb", synonyms_en: ["haemoglobin"], synonyms_ru: [] },
          ],
        },
      ],
    });

    const rows = await searchCatalogEntries(stub.client, {
      kind: "observation",
      query: "haemo",
      limit: 10,
    });

    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("does not duplicate a row found by both passes", async () => {
    const stub = createSupabaseStub({
      observation_catalog: [
        { data: [{ id: "1", obs_code: "hgb" }] },
        { data: [{ id: "1", obs_code: "hgb", synonyms_en: ["hgb long name"] }] },
      ],
    });

    const rows = await searchCatalogEntries(stub.client, {
      kind: "observation",
      query: "hgb",
      limit: 10,
    });

    expect(rows).toHaveLength(1);
  });

  it("respects the limit when merging synonym matches", async () => {
    const stub = createSupabaseStub({
      finding_type_catalog: [
        { data: [{ id: "1" }] },
        {
          data: [
            { id: "2", synonyms_en: ["polyp"], synonyms_ru: [] },
            { id: "3", synonyms_en: ["polyp"], synonyms_ru: [] },
          ],
        },
      ],
    });

    const rows = await searchCatalogEntries(stub.client, {
      kind: "finding_type",
      query: "polyp",
      limit: 2,
    });

    expect(rows).toHaveLength(2);
  });

  it("tolerates rows with no synonym arrays", async () => {
    const stub = createSupabaseStub({
      body_site_catalog: [{ data: [] }, { data: [{ id: "1" }] }],
    });

    await expect(
      searchCatalogEntries(stub.client, { kind: "body_site", query: "colon", limit: 10 }),
    ).resolves.toEqual([]);
  });

  it("tolerates the synonym pass returning nothing", async () => {
    const stub = createSupabaseStub({
      body_site_catalog: [{ data: [{ id: "1" }] }, { data: null }],
    });

    await expect(
      searchCatalogEntries(stub.client, { kind: "body_site", query: "colon", limit: 10 }),
    ).resolves.toHaveLength(1);
  });

  it("neutralizes PostgREST filter delimiters in the search text", async () => {
    const stub = createSupabaseStub({ measurement_catalog: [{ data: [] }] });
    await searchCatalogEntries(stub.client, {
      kind: "measurement",
      query: "a,b(c)",
      limit: 10,
    });

    const [[filter]] = stub.argsFor("measurement_catalog", "or");
    expect(filter).toBe("code.ilike.%a b c %,name_en.ilike.%a b c %,name_ru.ilike.%a b c %");
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ measurement_catalog: [{ error: { message: "boom" } }] });
    await expect(
      searchCatalogEntries(stub.client, { kind: "measurement", query: "x", limit: 5 }),
    ).rejects.toThrow(/Failed to search body measurement types/);
  });
});

describe("upsertCatalogEntry", () => {
  it("updates by id when one is given", async () => {
    const stub = createSupabaseStub({ measurement_catalog: [{ data: { id: "m-1" } }] });

    await upsertCatalogEntry(stub.client, {
      kind: "measurement",
      id: "m-1",
      values: { name_en: "Weight" },
    });

    expect(stub.argsFor("measurement_catalog", "update")).toEqual([[{ name_en: "Weight" }]]);
    expect(stub.argsFor("measurement_catalog", "eq")).toEqual([["id", "m-1"]]);
    expect(stub.argsFor("measurement_catalog", "upsert")).toHaveLength(0);
  });

  it("upserts on the natural key when no id is given", async () => {
    const stub = createSupabaseStub({ observation_catalog: [{ data: { id: "o-1" } }] });

    await upsertCatalogEntry(stub.client, {
      kind: "observation",
      values: { obs_code: "ferritin" },
    });

    expect(stub.argsFor("observation_catalog", "upsert")).toEqual([
      [{ obs_code: "ferritin" }, { onConflict: "obs_code" }],
    ]);
  });

  it("reports a missing row on update", async () => {
    const stub = createSupabaseStub({ measurement_catalog: [{ data: null }] });
    await expect(
      upsertCatalogEntry(stub.client, { kind: "measurement", id: "nope", values: {} }),
    ).rejects.toThrow(/No body measurement types entry with id nope/);
  });

  it("surfaces an update error", async () => {
    const stub = createSupabaseStub({ measurement_catalog: [{ error: { message: "boom" } }] });
    await expect(
      upsertCatalogEntry(stub.client, { kind: "measurement", id: "m-1", values: {} }),
    ).rejects.toThrow(/Failed to update body measurement types entry/);
  });

  it("surfaces an upsert error", async () => {
    const stub = createSupabaseStub({ observation_catalog: [{ error: { message: "boom" } }] });
    await expect(
      upsertCatalogEntry(stub.client, { kind: "observation", values: {} }),
    ).rejects.toThrow(/Failed to save lab analyte types entry/);
  });

  it("surfaces a silent no-row upsert", async () => {
    const stub = createSupabaseStub({ observation_catalog: [{ data: null }] });
    await expect(
      upsertCatalogEntry(stub.client, { kind: "observation", values: {} }),
    ).rejects.toThrow(/no row returned/);
  });
});
