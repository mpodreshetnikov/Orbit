import { describe, expect, it } from "vitest";
import { getFindingHistory, searchFindings } from "./findings";
import { createSupabaseStub } from "./test-support";

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: "f-1",
    record_id: "r-1",
    finding_code: "polyp",
    finding_type_text: "Polyp",
    site_code: "colon",
    body_site_text: "Colon",
    size_mm: 4,
    count: 1,
    severity: "mild",
    laterality: "none",
    morphology: null,
    description: null,
    histology: null,
    finding_date: "2026-02-01",
    is_user_verified: true,
    resolution_status: "observed",
    ...overrides,
  };
}

describe("searchFindings", () => {
  it("filters directly on person_id, since this table carries it", async () => {
    const stub = createSupabaseStub({ record_findings: [{ data: [] }] });
    await searchFindings(stub.client, { personId: "p-1", limit: 20, offset: 0 });

    expect(stub.argsFor("record_findings", "eq")).toEqual([["person_id", "p-1"]]);
    // No join through medical_records is needed here, unlike observations.
    expect(stub.argsFor("record_findings", "select")[0][0]).not.toContain("medical_records");
  });

  it("derives is_resolved from the resolution status, not from zeros", async () => {
    const stub = createSupabaseStub({
      record_findings: [
        {
          data: [
            finding({ id: "open", size_mm: 4, count: 1 }),
            // A measurement that really was zero: still an observed finding.
            finding({ id: "measured-zero", size_mm: 0, count: 0 }),
            finding({ id: "closed", size_mm: null, count: null, resolution_status: "resolved" }),
          ],
        },
      ],
    });

    const rows = await searchFindings(stub.client, { personId: "p-1", limit: 20, offset: 0 });

    expect(rows.map((r) => r.is_resolved)).toEqual([false, false, true]);
  });

  it("treats a null size as unresolved", async () => {
    const stub = createSupabaseStub({
      record_findings: [{ data: [finding({ size_mm: null, count: null })] }],
    });

    const [row] = await searchFindings(stub.client, { personId: "p-1", limit: 20, offset: 0 });
    expect(row.is_resolved).toBe(false);
  });

  it.each([
    ["findingCode", { findingCode: "polyp" }, ["finding_code", "polyp"]],
    ["siteCode", { siteCode: "colon" }, ["site_code", "colon"]],
    ["severity", { severity: "severe" }, ["severity", "severe"]],
    ["laterality", { laterality: "left" }, ["laterality", "left"]],
  ])("pushes %s to the database", async (_label, extra, expected) => {
    const stub = createSupabaseStub({ record_findings: [{ data: [] }] });
    await searchFindings(stub.client, { personId: "p-1", limit: 20, offset: 0, ...extra });

    expect(stub.argsFor("record_findings", "eq")).toEqual(expect.arrayContaining([expected]));
  });

  it("applies a date range", async () => {
    const stub = createSupabaseStub({ record_findings: [{ data: [] }] });
    await searchFindings(stub.client, {
      personId: "p-1",
      from: "2026-01-01",
      to: "2026-12-31",
      limit: 20,
      offset: 0,
    });

    expect(stub.argsFor("record_findings", "gte")).toEqual([["finding_date", "2026-01-01"]]);
    expect(stub.argsFor("record_findings", "lte")).toEqual([["finding_date", "2026-12-31"]]);
  });

  it("searches type, site and description together", async () => {
    const stub = createSupabaseStub({ record_findings: [{ data: [] }] });
    await searchFindings(stub.client, { personId: "p-1", query: "cyst", limit: 20, offset: 0 });

    const [[filter]] = stub.argsFor("record_findings", "or");
    expect(filter).toBe(
      "finding_type_text.ilike.%cyst%,body_site_text.ilike.%cyst%,description.ilike.%cyst%",
    );
  });

  it("neutralizes PostgREST filter delimiters in the search text", async () => {
    const stub = createSupabaseStub({ record_findings: [{ data: [] }] });
    await searchFindings(stub.client, { personId: "p-1", query: "a,(b)", limit: 20, offset: 0 });

    const [[filter]] = stub.argsFor("record_findings", "or");
    // Each of `,`, `(` and `)` becomes a space, so "a,(b)" -> "a  b ".
    expect(filter).toBe(
      "finding_type_text.ilike.%a  b %,body_site_text.ilike.%a  b %,description.ilike.%a  b %",
    );
  });

  it("ignores a whitespace-only query", async () => {
    const stub = createSupabaseStub({ record_findings: [{ data: [] }] });
    await searchFindings(stub.client, { personId: "p-1", query: "   ", limit: 20, offset: 0 });

    expect(stub.argsFor("record_findings", "or")).toHaveLength(0);
  });

  it("pages with an inclusive range", async () => {
    const stub = createSupabaseStub({ record_findings: [{ data: [] }] });
    await searchFindings(stub.client, { personId: "p-1", limit: 10, offset: 30 });

    expect(stub.argsFor("record_findings", "range")).toEqual([[30, 39]]);
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ record_findings: [{ error: { message: "boom" } }] });
    await expect(
      searchFindings(stub.client, { personId: "p-1", limit: 20, offset: 0 }),
    ).rejects.toThrow(/Failed to search findings/);
  });
});

describe("getFindingHistory", () => {
  it("returns one finding's entries oldest first", async () => {
    const stub = createSupabaseStub({ record_findings: [{ data: [finding()] }] });
    await getFindingHistory(stub.client, { personId: "p-1", findingCode: "polyp", limit: 50 });

    expect(stub.argsFor("record_findings", "order")).toEqual([
      ["finding_date", { ascending: true, nullsFirst: true }],
    ]);
    expect(stub.argsFor("record_findings", "eq")).toEqual([
      ["person_id", "p-1"],
      ["finding_code", "polyp"],
    ]);
  });

  it("narrows to a body site when one is given", async () => {
    const stub = createSupabaseStub({ record_findings: [{ data: [] }] });
    await getFindingHistory(stub.client, {
      personId: "p-1",
      findingCode: "polyp",
      siteCode: "colon",
      limit: 50,
    });

    expect(stub.argsFor("record_findings", "eq")).toEqual(
      expect.arrayContaining([["site_code", "colon"]]),
    );
  });

  it("flags resolution in history too", async () => {
    const stub = createSupabaseStub({
      record_findings: [
        { data: [finding(), finding({ id: "f-2", resolution_status: "resolved" })] },
      ],
    });

    const rows = await getFindingHistory(stub.client, {
      personId: "p-1",
      findingCode: "polyp",
      limit: 50,
    });

    expect(rows.map((r) => r.is_resolved)).toEqual([false, true]);
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ record_findings: [{ error: { message: "boom" } }] });
    await expect(
      getFindingHistory(stub.client, { personId: "p-1", findingCode: "polyp", limit: 50 }),
    ).rejects.toThrow(/Failed to load finding history/);
  });
});
