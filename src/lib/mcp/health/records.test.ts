import { describe, expect, it } from "vitest";
import {
  getMedicalRecord,
  getRecordConditions,
  getRecordFindings,
  getRecordObservations,
  listPendingRecords,
  PENDING_RECORD_STATUSES,
  searchMedicalRecords,
} from "./records";
import { createSupabaseStub } from "./test-support";

describe("searchMedicalRecords", () => {
  const panel = {
    id: "r-panel",
    person_id: "p-1",
    title: "Ferritin panel",
    record_type: "lab",
    record_date: "2026-02-01",
    status: "active",
    notes: null,
    llm_summary: "Iron studies",
    llm_keywords: ["ferritin"],
    attachment_count: 2,
  };

  it("defaults to finished documents only", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { data: [panel] } });

    const rows = await searchMedicalRecords(stub.client, { limit: 20, offset: 0 });

    expect(stub.rpc).toHaveBeenCalledWith(
      "search_medical_records",
      expect.objectContaining({ p_statuses: ["active"] }),
    );
    expect(rows).toStrictEqual([panel]);
  });

  it("leaves the OCR text out of what it returns", async () => {
    const stub = createSupabaseStub(
      {},
      {
        search_medical_records: {
          data: [{ id: "r-1", title: "ОАК", status: "active", ocr_text: "x".repeat(76000) }],
        },
      },
    );
    const [row] = await searchMedicalRecords(stub.client, { limit: 20, offset: 0 });
    expect(row).not.toHaveProperty("ocr_text");
    expect(row).toMatchObject({ id: "r-1", title: "ОАК", status: "active" });
  });

  it("can widen to in-progress documents", async () => {
    const pending = { ...panel, id: "r-pending", status: "ocr_review" };
    const stub = createSupabaseStub({}, { search_medical_records: { data: [pending, panel] } });

    const rows = await searchMedicalRecords(stub.client, {
      statuses: ["active", "ocr_review"],
      limit: 20,
      offset: 0,
    });

    expect(stub.rpc).toHaveBeenCalledWith(
      "search_medical_records",
      expect.objectContaining({ p_statuses: ["active", "ocr_review"] }),
    );
    expect(rows).toStrictEqual([pending, panel]);
  });

  it("omits an empty query rather than searching for the empty string", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { data: [] } });
    await searchMedicalRecords(stub.client, { query: "   ", limit: 20, offset: 0 });

    const [, params] = stub.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.search_query).toBe(undefined);
  });

  it("passes the query, person and type through", async () => {
    const match = { ...panel, search_rank: 0.75 };
    const stub = createSupabaseStub({}, { search_medical_records: { data: [match] } });

    const rows = await searchMedicalRecords(stub.client, {
      query: "  ferritin  ",
      personId: "p-1",
      recordType: "lab",
      limit: 5,
      offset: 10,
    });

    expect(stub.rpc).toHaveBeenCalledWith(
      "search_medical_records",
      expect.objectContaining({
        search_query: "ferritin",
        p_person_id: "p-1",
        p_record_type: "lab",
        p_limit: 5,
        p_offset: 10,
      }),
    );
    expect(rows).toStrictEqual([match]);
  });

  it("omits an empty person id so the search spans everyone", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { data: [] } });
    await searchMedicalRecords(stub.client, { personId: "", limit: 20, offset: 0 });

    const [, params] = stub.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_person_id).toBe(undefined);
  });

  it("returns an empty list rather than null", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { data: null } });
    await expect(searchMedicalRecords(stub.client, { limit: 20, offset: 0 })).resolves.toEqual([]);
  });

  it("surfaces an RPC error", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { error: { message: "boom" } } });
    await expect(searchMedicalRecords(stub.client, { limit: 20, offset: 0 })).rejects.toThrow(
      /Failed to search medical records/,
    );
  });
});

describe("getMedicalRecord", () => {
  it("embeds attachments alongside the record", async () => {
    const stub = createSupabaseStub({ medical_records: [{ data: { id: "r-1" } }] });

    await expect(getMedicalRecord(stub.client, "r-1")).resolves.toMatchObject({ id: "r-1" });
    expect(stub.argsFor("medical_records", "select")[0][0]).toContain("record_attachments");
    expect(stub.argsFor("medical_records", "eq")).toEqual([["id", "r-1"]]);
  });

  it("notes person_id on the MCP audit scope when a row loads", async () => {
    const { currentMcpPersonId, runWithMcpToolAuditScope } = await import("../audit");
    const stub = createSupabaseStub({
      medical_records: [{ data: { id: "r-1", person_id: "person-owned" } }],
    });

    await runWithMcpToolAuditScope(async () => {
      await getMedicalRecord(stub.client, "r-1");
      expect(currentMcpPersonId()).toBe("person-owned");
    });
  });

  it("returns null for an unknown record", async () => {
    const stub = createSupabaseStub({ medical_records: [{ data: null }] });
    await expect(getMedicalRecord(stub.client, "nope")).resolves.toBeNull();
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ medical_records: [{ error: { message: "boom" } }] });
    await expect(getMedicalRecord(stub.client, "r-1")).rejects.toThrow(
      /Failed to load medical record/,
    );
  });
});

describe("record extraction helpers", () => {
  const cases = [
    ["observations", getRecordObservations, "get_record_observations", /record observations/],
    ["findings", getRecordFindings, "get_record_findings", /record findings/],
    ["diagnoses", getRecordConditions, "get_record_conditions", /record diagnoses/],
  ] as const;

  it.each(cases)("%s calls its RPC with the record id", async (_label, fn, rpcName) => {
    const stub = createSupabaseStub({}, { [rpcName]: { data: [{ id: "x" }] } });

    await expect(fn(stub.client, "r-1")).resolves.toHaveLength(1);
    expect(stub.rpc).toHaveBeenCalledWith(rpcName, { p_record_id: "r-1" });
  });

  it.each(cases)("%s returns an empty list rather than null", async (_label, fn, rpcName) => {
    const stub = createSupabaseStub({}, { [rpcName]: { data: null } });
    await expect(fn(stub.client, "r-1")).resolves.toEqual([]);
  });

  it.each(cases)("%s surfaces an RPC error", async (_label, fn, rpcName, message) => {
    const stub = createSupabaseStub({}, { [rpcName]: { error: { message: "boom" } } });
    await expect(fn(stub.client, "r-1")).rejects.toThrow(message);
  });
});

describe("getRecordConditions and pending closures", () => {
  function mention(overrides: Record<string, unknown> = {}) {
    return {
      id: "cr-1",
      condition_id: "cond-1",
      status_in_record: "resolved",
      is_llm_extracted: true,
      is_user_verified: false,
      ...overrides,
    };
  }

  it("marks a suppressed closure at the source, so every reader of a record gets it", async () => {
    // get_condition was given this treatment first and get_medical_record — the "show me this
    // report" path, and the more common one — was left returning the RPC rows untouched.
    const stub = createSupabaseStub({}, { get_record_conditions: { data: [mention()] } });

    const rows = await getRecordConditions(stub.client, "r-1");

    expect(rows[0].awaiting_confirmation).toBe(true);
    expect(String(rows[0].not_applied_reason)).toContain("NOT changed");
  });

  it("leaves mentions that nobody is waiting on unmarked", async () => {
    const stub = createSupabaseStub(
      {},
      {
        get_record_conditions: {
          data: [
            mention({ id: "confirmed", is_user_verified: true }),
            mention({ id: "by-hand", is_llm_extracted: false }),
            mention({ id: "not-a-closure", status_in_record: "active" }),
          ],
        },
      },
    );

    const rows = await getRecordConditions(stub.client, "r-1");

    expect(rows.map((r) => r.awaiting_confirmation)).toEqual([false, false, false]);
  });
});

describe("listPendingRecords", () => {
  it("lists every status but active, newest activity first, for one person", async () => {
    const stub = createSupabaseStub({ medical_records: [{ data: [] }] });
    await listPendingRecords(stub.client, { personId: "p-1", limit: 20 });

    expect(stub.argsFor("medical_records", "in")).toEqual([["status", PENDING_RECORD_STATUSES]]);
    expect(PENDING_RECORD_STATUSES).not.toContain("active");
    expect(PENDING_RECORD_STATUSES).toContain("structure_review");
    expect(stub.argsFor("medical_records", "order")).toEqual([
      ["updated_at", { ascending: false }],
    ]);
    expect(stub.argsFor("medical_records", "eq")).toEqual([["person_id", "p-1"]]);
  });
});
