import { describe, expect, it, vi } from "vitest";
import {
  activateMedicalRecord,
  createDraftRecord,
  dismissConditionClosure,
  findMissingPages,
  removeRecordDraft,
  storagePathForPage,
} from "./documents";
import { createSupabaseStub, type StubResult } from "./test-support";

/** The PostgREST stub plus the two storage calls this layer makes. */
function stubWithStorage(
  queues: Record<string, StubResult[]>,
  rpcResults: Record<string, StubResult> = {},
  storedFiles: string[] = [],
) {
  const stub = createSupabaseStub(queues, rpcResults);
  const createSignedUploadUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://orbit.test/storage/v1/object/upload/sign/${path}?token=t` },
    error: null,
  }));
  const list = vi.fn(async () => ({
    data: storedFiles.map((name) => ({ name })),
    error: null,
  }));
  Object.assign(stub.client, { storage: { from: vi.fn(() => ({ createSignedUploadUrl, list })) } });
  return { ...stub, createSignedUploadUrl, list };
}

const B12_CLOSURE = {
  id: "cr-b12",
  condition_id: "cond-b12",
  is_proposal: false,
  status_in_record: "resolved",
  supporting_obs_code: "vitamin_b12",
  is_llm_extracted: true,
  is_user_verified: false,
  review_decision: "pending",
};

const B12_IN_RANGE = {
  obs_code: "vitamin_b12",
  is_applied: true,
  value_numeric: 704,
  value_canonical: 519.6,
  ref_range_low: 197,
  ref_range_high: 771,
  ref_range_low_canonical: 145.4,
  ref_range_high_canonical: 569,
  status: "normal",
};

describe("storagePathForPage", () => {
  it("keeps storage keys ASCII and numbers pages from one", () => {
    expect(storagePathForPage("p", "r", 0, "Анализ крови 1.jpg")).toBe(
      `p/r/1-${"_".repeat(13)}1.jpg`,
    );
  });
});

describe("createDraftRecord", () => {
  it("writes a draft, one attachment per page, and signs an upload for each", async () => {
    const stub = stubWithStorage({
      medical_records: [{ data: { id: "rec-1" } }],
      record_attachments: [
        {
          data: [
            {
              id: "a-1",
              storage_path: "p-1/rec-1/1-page1.jpg",
              mime_type: "image/jpeg",
              original_filename: "page1.jpg",
            },
            {
              id: "a-2",
              storage_path: "p-1/rec-1/2-page2.pdf",
              mime_type: "application/pdf",
              original_filename: "page2.pdf",
            },
          ],
        },
      ],
    });

    const result = await createDraftRecord(stub.client, {
      personId: "p-1",
      userId: "u-1",
      recordType: "lab",
      recordDate: "2025-10-27",
      title: "Витамины",
      pages: [
        { filename: "page1.jpg", mime_type: "image/jpeg" },
        { filename: "page2.pdf", mime_type: "application/pdf" },
      ],
    });

    expect(stub.argsFor("medical_records", "insert")[0][0]).toMatchObject({
      person_id: "p-1",
      created_by_user_id: "u-1",
      status: "draft",
    });
    expect(stub.argsFor("record_attachments", "insert")[0][0]).toEqual([
      expect.objectContaining({ storage_path: "p-1/rec-1/1-page1.jpg", sort_order: 0 }),
      expect.objectContaining({ storage_path: "p-1/rec-1/2-page2.pdf", sort_order: 1 }),
    ]);
    expect(result.recordId).toBe("rec-1");
    expect(result.uploads.map((upload) => upload.upload_url)).toEqual([
      expect.stringContaining("p-1/rec-1/1-page1.jpg"),
      expect.stringContaining("p-1/rec-1/2-page2.pdf"),
    ]);
  });

  it("takes the record back out when its pages cannot be registered", async () => {
    const stub = stubWithStorage({
      medical_records: [{ data: { id: "rec-1" } }, { data: null }],
      record_attachments: [{ error: { message: "denied" } }],
    });

    await expect(
      createDraftRecord(stub.client, {
        personId: "p-1",
        userId: "u-1",
        recordType: "lab",
        recordDate: null,
        title: "x",
        pages: [{ filename: "a.png", mime_type: "image/png" }],
      }),
    ).rejects.toThrow("denied");
    expect(stub.argsFor("medical_records", "delete")).toHaveLength(1);
  });
});

describe("findMissingPages", () => {
  it("names the pages whose file is not in the record's folder", async () => {
    const stub = stubWithStorage({}, {}, ["1-a.png"]);
    const missing = await findMissingPages(stub.client, {
      id: "rec-1",
      person_id: "p-1",
      status: "draft",
      title: "x",
      attachments: [
        {
          id: "a-1",
          original_filename: "a.png",
          storage_path: "p-1/rec-1/1-a.png",
          mime_type: "image/png",
        },
        {
          id: "a-2",
          original_filename: "b.png",
          storage_path: "p-1/rec-1/2-b.png",
          mime_type: "image/png",
        },
      ],
    });
    expect(missing.map((page) => page.original_filename)).toEqual(["b.png"]);
    expect(stub.list).toHaveBeenCalledWith("p-1/rec-1", { limit: 1000 });
  });
});

describe("dismissConditionClosure", () => {
  it("records the dismissal and leaves the closure unverified", async () => {
    const stub = createSupabaseStub({ condition_records: [{ data: B12_CLOSURE }, { data: null }] });
    expect(await dismissConditionClosure(stub.client, "cr-b12")).toEqual({ status: "dismissed" });
    expect(stub.argsFor("condition_records", "update")).toEqual([
      [{ review_decision: "dismissed" }],
    ]);
  });

  it("refuses a mention that is not an unconfirmed closure", async () => {
    const stub = createSupabaseStub({
      condition_records: [{ data: { ...B12_CLOSURE, status_in_record: "active" } }],
    });
    expect(await dismissConditionClosure(stub.client, "cr-b12")).toEqual({
      status: "not_a_pending_closure",
    });
    expect(stub.argsFor("condition_records", "update")).toEqual([]);
  });
});

describe("activateMedicalRecord", () => {
  const record = { id: "rec-1", person_id: "p-1" };
  const lookupIcd = vi.fn(async () => null);

  it("approves the record by the review screen's rules", async () => {
    const stub = createSupabaseStub(
      {
        record_observations: [
          { data: [{ id: "obs-unmatched" }] }, // delete of unapplied rows
          { data: null }, // verify
          { data: [B12_IN_RANGE] }, // closure re-check
        ],
        medical_records: [
          {
            data: {
              llm_suggested_checkup_completions: [
                { checkup_item_id: "chk-1", suggested_done_at: "2025-10-27", reason: "B12 сдан" },
              ],
            },
          },
          { data: null },
        ],
        record_findings: [{ data: null }],
        condition_records: [
          { data: null }, // confirm
          { data: { status_in_record: "resolved" } }, // recompute read
        ],
        conditions: [{ data: null }],
        checkup_completions: [{ data: null }],
      },
      {
        get_record_conditions: {
          data: [B12_CLOSURE, { ...B12_CLOSURE, id: "cr-dismissed", review_decision: "dismissed" }],
        },
      },
    );

    const outcome = await activateMedicalRecord(stub.client, record, { lookupIcd });

    expect(stub.argsFor("record_observations", "eq")[0]).toEqual(["record_id", "rec-1"]);
    expect(stub.argsFor("record_observations", "eq")[1]).toEqual(["is_applied", false]);
    expect(stub.argsFor("medical_records", "update")[0][0]).toEqual({ status: "active" });
    expect(stub.argsFor("condition_records", "update")).toEqual([
      [{ is_user_verified: true, review_decision: "confirmed" }],
    ]);
    expect(stub.argsFor("conditions", "update")).toEqual([[{ current_status: "resolved" }]]);
    expect(stub.argsFor("checkup_completions", "insert")[0][0]).toEqual({
      checkup_item_id: "chk-1",
      done_at: "2025-10-27",
      note: "B12 сдан",
      evidence_record_id: "rec-1",
    });
    expect(outcome).toEqual({
      droppedUnmatchedObservations: 1,
      proposalsMaterialized: 0,
      proposalsSkipped: 0,
      mentionsConfirmed: 1,
      closuresLeftPending: 0,
      checkupsCompleted: 1,
    });
  });

  it("leaves a closure pending when its measurement no longer holds", async () => {
    const stub = createSupabaseStub(
      {
        record_observations: [
          { data: [] },
          { data: null },
          { data: [{ ...B12_IN_RANGE, value_canonical: 100 }] },
        ],
        medical_records: [{ data: { llm_suggested_checkup_completions: null } }],
        record_findings: [{ data: null }],
      },
      { get_record_conditions: { data: [B12_CLOSURE] } },
    );

    const outcome = await activateMedicalRecord(stub.client, record, { lookupIcd });

    expect(stub.argsFor("condition_records", "update")).toEqual([]);
    expect(outcome.closuresLeftPending).toBe(1);
    expect(outcome.mentionsConfirmed).toBe(0);
  });
});

describe("removeRecordDraft", () => {
  it("sets a record in review aside, as the app's Remove does", async () => {
    const stub = createSupabaseStub({
      medical_records: [{ data: { id: "r-1", status: "structure_review" } }, { data: null }],
    });
    expect(await removeRecordDraft(stub.client, "r-1")).toEqual({ status: "removed" });
    const [[update]] = stub.argsFor("medical_records", "update") as [[Record<string, unknown>]];
    expect(update.status).toBe("removed");
    expect(typeof update.removed_at).toBe("string");
  });

  it("refuses an approved record and touches nothing", async () => {
    const stub = createSupabaseStub({
      medical_records: [{ data: { id: "r-1", status: "active" } }],
    });
    expect(await removeRecordDraft(stub.client, "r-1")).toEqual({
      status: "not_a_draft",
      recordStatus: "active",
    });
    expect(stub.argsFor("medical_records", "update")).toEqual([]);
  });

  it("reports a record that is not there", async () => {
    const stub = createSupabaseStub({ medical_records: [{ data: null }] });
    expect(await removeRecordDraft(stub.client, "r-1")).toEqual({ status: "not_found" });
  });
});
