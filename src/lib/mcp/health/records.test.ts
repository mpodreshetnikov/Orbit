import { describe, expect, it } from "vitest";
import {
  ACTIVE_RECORD_STATUSES,
  ALL_RECORD_STATUSES,
  getMedicalRecord,
  getRecordConditions,
  getRecordFindings,
  getRecordObservations,
  searchMedicalRecords,
} from "./records";
import { createSupabaseStub } from "./test-support";

describe("searchMedicalRecords", () => {
  it("defaults to finished documents only", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { data: [] } });
    await searchMedicalRecords(stub.client, { limit: 20, offset: 0 });

    expect(stub.rpc).toHaveBeenCalledWith(
      "search_medical_records",
      expect.objectContaining({ p_statuses: ACTIVE_RECORD_STATUSES }),
    );
  });

  it("can widen to in-progress documents", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { data: [] } });
    await searchMedicalRecords(stub.client, {
      statuses: ALL_RECORD_STATUSES,
      limit: 20,
      offset: 0,
    });

    expect(stub.rpc).toHaveBeenCalledWith(
      "search_medical_records",
      expect.objectContaining({ p_statuses: ALL_RECORD_STATUSES }),
    );
  });

  it("omits an empty query rather than searching for the empty string", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { data: [] } });
    await searchMedicalRecords(stub.client, { query: "   ", limit: 20, offset: 0 });

    const [, params] = stub.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.search_query).toBeUndefined();
  });

  it("passes the query, person and type through", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { data: [] } });
    await searchMedicalRecords(stub.client, {
      query: "ferritin",
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
  });

  it("omits an empty person id so the search spans everyone", async () => {
    const stub = createSupabaseStub({}, { search_medical_records: { data: [] } });
    await searchMedicalRecords(stub.client, { personId: "", limit: 20, offset: 0 });

    const [, params] = stub.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_person_id).toBeUndefined();
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
