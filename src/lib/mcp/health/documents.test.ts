import { describe, expect, it, vi } from "vitest";
import {
  activateMedicalRecord,
  applyRecordProposals,
  createDraftRecord,
  dismissConditionClosure,
  dismissRecordProposals,
  findMissingPages,
  signRecordPageLinks,
  proposeRecordReconciliation,
  recordPageSizes,
  removeRecordDraft,
  storagePathForPage,
  suggestReconciliation,
} from "./documents";
import { createSupabaseStub, type StubResult } from "./test-support";

/** The PostgREST stub plus the two storage calls this layer makes. */
function stubWithStorage(
  queues: Record<string, StubResult[]>,
  rpcResults: Record<string, StubResult> = {},
  storedFiles: Array<string | { name: string; metadata: { size: number } }> = [],
) {
  const stub = createSupabaseStub(queues, rpcResults);
  const createSignedUploadUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://orbit.test/storage/v1/object/upload/sign/${path}?token=t` },
    error: null,
  }));
  const list = vi.fn(async () => ({
    data: storedFiles.map((file) => (typeof file === "string" ? { name: file } : file)),
    error: null,
  }));
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) =>
      path.includes("missing")
        ? { path, signedUrl: "", error: "Object not found" }
        : {
            path,
            signedUrl: `https://orbit.test/storage/v1/object/sign/${path}?token=t`,
            error: null,
          },
    ),
    error: null,
  }));
  Object.assign(stub.client, {
    storage: { from: vi.fn(() => ({ createSignedUploadUrl, createSignedUrls, list })) },
  });
  return { ...stub, createSignedUploadUrl, createSignedUrls, list };
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

describe("signRecordPageLinks", () => {
  it("links each page for an hour, in page order, and keeps a page it cannot sign by name", async () => {
    const stub = stubWithStorage({
      record_attachments: [
        {
          data: [
            { original_filename: "a.jpg", mime_type: "image/jpeg", storage_path: "p/r/1-a.jpg" },
            {
              original_filename: "b.pdf",
              mime_type: "application/pdf",
              storage_path: "p/r/2-missing.pdf",
            },
          ],
        },
      ],
    });

    const pages = await signRecordPageLinks(stub.client, "r");

    expect(stub.argsFor("record_attachments", "order")).toEqual([
      ["sort_order", { ascending: true }],
    ]);
    expect(stub.createSignedUrls).toHaveBeenCalledWith(["p/r/1-a.jpg", "p/r/2-missing.pdf"], 3600);
    expect(pages).toEqual([
      {
        name: "a.jpg",
        mime_type: "image/jpeg",
        url: "https://orbit.test/storage/v1/object/sign/p/r/1-a.jpg?token=t",
      },
      { name: "b.pdf", mime_type: "application/pdf", url: null },
    ]);
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

describe("recordPageSizes", () => {
  it("writes the size storage reports onto each uploaded page that lacks it", async () => {
    const stub = stubWithStorage({ record_attachments: [{ data: null }] }, {}, [
      { name: "1-a.png", metadata: { size: 2048 } },
      { name: "2-b.png", metadata: { size: 4096 } },
    ]);
    await recordPageSizes(stub.client, {
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
          file_size: null,
        },
        {
          id: "a-2",
          original_filename: "b.png",
          storage_path: "p-1/rec-1/2-b.png",
          mime_type: "image/png",
          file_size: 4096,
        },
      ],
    });

    expect(stub.argsFor("record_attachments", "update")).toEqual([[{ file_size: 2048 }]]);
    expect(stub.argsFor("record_attachments", "eq")).toEqual([["id", "a-1"]]);
  });
});

describe("suggestReconciliation", () => {
  it("leaves a checkup completed after the document out, by its latest completion", async () => {
    const checkup = (id: string, title: string) => ({
      id,
      title,
      category: "lab",
      schedule: { type: "interval", every: 1, unit: "year" },
      next_due_at: "2026-03-01",
    });
    const stub = createSupabaseStub({
      conditions: [
        {
          data: [
            { id: "c-d", name: "Дефицит витамина D", code: "E55.9", current_status: "active" },
          ],
        },
      ],
      checkup_items: [{ data: [checkup("k-d", "Витамин D"), checkup("k-b12", "Витамин B12")] }],
      checkup_completions: [
        {
          data: [
            { checkup_item_id: "k-b12", done_at: "2026-03-10" },
            { checkup_item_id: "k-b12", done_at: "2025-03-01" },
          ],
        },
      ],
    });

    const context = await suggestReconciliation(stub.client, "p-1", {
      recordDate: "2026-03-06",
      sourceText: "Витамин D (25-OH) 31.08 нг/мл; Витамин B12 704 пг/мл",
      observationLabels: [],
    });

    expect(context.suggestions.map((s) => s.id)).toEqual(["c-d", "k-d"]);
    expect(stub.argsFor("checkup_completions", "in")).toEqual([
      ["checkup_item_id", ["k-d", "k-b12"]],
    ]);
  });

  it("does not ask for completions when no checkup is due", async () => {
    const stub = createSupabaseStub({ conditions: [{ data: [] }], checkup_items: [{ data: [] }] });
    const context = await suggestReconciliation(stub.client, "p-1", {
      recordDate: "2026-03-06",
      sourceText: "",
      observationLabels: [],
    });
    expect(context).toEqual({ suggestions: [], alsoDue: [] });
    expect(stub.argsFor("checkup_completions", "select")).toEqual([]);
  });

  it("fails loudly when the conditions cannot be read", async () => {
    const stub = createSupabaseStub({
      conditions: [{ error: { message: "boom" } }],
      checkup_items: [{ data: [] }],
    });
    await expect(
      suggestReconciliation(stub.client, "p-1", {
        recordDate: null,
        sourceText: "",
        observationLabels: [],
      }),
    ).rejects.toThrow("boom");
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
          { data: [{ id: "obs-unmatched" }] }, // count of unapplied rows, which stay
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
    expect(stub.argsFor("record_observations", "delete")).toHaveLength(0);
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
      keptUnmatchedObservations: 1,
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

describe("proposeRecordReconciliation", () => {
  const record = {
    id: "rec-1",
    person_id: "p-1",
    record_date: "2026-03-06",
    ocr_text: "Витамин B12 704 пг/мл (197-771)\nВитамин D 31.08",
  };
  const condition = (id: string, name: string, current_status = "active") => ({
    id,
    name,
    current_status,
  });

  it("writes a closure nobody has verified, and refuses what the record cannot back", async () => {
    const stub = createSupabaseStub({
      conditions: [
        {
          data: [
            condition("cond-b12", "Недостаточность B12"),
            condition("cond-d", "Дефицит витамина D"),
            condition("cond-dm", "Сахарный диабет"),
            condition("cond-gone", "Гастрит", "resolved"),
            condition("cond-mentioned", "Описторхоз"),
          ],
        },
      ],
      condition_records: [
        { data: [{ condition_id: "cond-mentioned", status_in_record: "suspected" }] },
        { data: null }, // insert
      ],
      record_observations: [{ data: [B12_IN_RANGE] }],
    });

    const outcome = await proposeRecordReconciliation(stub.client, record, {
      conditions: [
        {
          condition_id: "cond-b12",
          status: "resolved",
          source_anchor: "витамин b12 704",
          supporting_obs_code: "vitamin_b12",
        },
        {
          condition_id: "cond-d",
          status: "resolved",
          source_anchor: "Витамин D 31.08",
          supporting_obs_code: "vitamin_d_25oh",
        },
        {
          condition_id: "cond-dm",
          status: "resolved",
          source_anchor: "Витамин B12 704",
          supporting_obs_code: "vitamin_b12",
        },
        {
          condition_id: "cond-gone",
          status: "resolved",
          source_anchor: "x",
          supporting_obs_code: null,
        },
        {
          condition_id: "cond-mentioned",
          status: "resolved",
          source_anchor: "Витамин D",
          supporting_obs_code: null,
        },
        {
          condition_id: "cond-other",
          status: "resolved",
          source_anchor: "x",
          supporting_obs_code: null,
        },
        {
          condition_id: "cond-b12",
          status: "history",
          source_anchor: "не из этого документа",
          supporting_obs_code: null,
        },
      ],
      checkups: [],
    });

    expect(stub.argsFor("condition_records", "insert")).toEqual([
      [
        {
          condition_id: "cond-b12",
          record_id: "rec-1",
          status_in_record: "resolved",
          source_anchor: "витамин b12 704",
          supporting_obs_code: "vitamin_b12",
          is_llm_extracted: true,
          is_user_verified: false,
          review_decision: "pending",
        },
      ],
    ]);
    expect(outcome.proposedClosures).toBe(1);
    expect(outcome.refused).toEqual([
      { id: "cond-d", reason: expect.stringContaining("does not hold vitamin_d_25oh in range") },
      {
        id: "cond-dm",
        reason: expect.stringContaining("vitamin_b12 does not decide Сахарный диабет"),
      },
      { id: "cond-gone", reason: "Гастрит is already resolved" },
      { id: "cond-mentioned", reason: expect.stringContaining("already mentions Описторхоз") },
      { id: "cond-other", reason: "not one of this person's conditions" },
      {
        id: "cond-b12",
        reason: expect.stringContaining("source_anchor is not in the record's text"),
      },
    ]);
  });

  it("queues completions on the record beside the ones already waiting, never before the last one done", async () => {
    const stub = createSupabaseStub({
      checkup_items: [
        {
          data: [
            { id: "k-d", title: "Витамин D", status: "active" },
            { id: "k-done", title: "ОАК", status: "active" },
            { id: "k-paused", title: "УЗИ", status: "paused" },
          ],
        },
      ],
      checkup_completions: [{ data: [{ checkup_item_id: "k-done", done_at: "2026-03-10" }] }],
      medical_records: [
        {
          data: {
            llm_suggested_checkup_completions: [
              { checkup_item_id: "k-old", suggested_done_at: "2026-03-06", reason: "раньше" },
              { checkup_item_id: "k-d", suggested_done_at: "2026-03-01", reason: "заменится" },
            ],
            updated_at: "2026-10-26T13:00:00.123456+00:00",
          },
        },
        { data: [{ id: "rec-1" }] },
      ],
    });

    const outcome = await proposeRecordReconciliation(stub.client, record, {
      conditions: [],
      checkups: [
        { checkup_item_id: "k-d", done_at: "2026-03-06", reason: "D в бланке" },
        { checkup_item_id: "k-done", done_at: "2026-03-06", reason: "ОАК в бланке" },
        { checkup_item_id: "k-paused", done_at: "2026-03-06", reason: "—" },
      ],
    });

    expect(stub.argsFor("medical_records", "update")).toEqual([
      [
        {
          llm_suggested_checkup_completions: [
            { checkup_item_id: "k-old", suggested_done_at: "2026-03-06", reason: "раньше" },
            { checkup_item_id: "k-d", suggested_done_at: "2026-03-06", reason: "D в бланке" },
          ],
        },
      ],
    ]);
    expect(stub.argsFor("medical_records", "eq")).toContainEqual([
      "updated_at",
      "2026-10-26T13:00:00.123456+00:00",
    ]);
    expect(outcome.proposedCompletions).toBe(1);
    expect(outcome.refused).toEqual([
      { id: "k-done", reason: "ОАК was already done on 2026-03-10" },
      { id: "k-paused", reason: "УЗИ is paused" },
    ]);
  });

  it("keeps a completion another call queued between its read and its write", async () => {
    const queued = (ids: string[], updatedAt: string) => ({
      data: {
        llm_suggested_checkup_completions: ids.map((id) => ({
          checkup_item_id: id,
          suggested_done_at: "2026-03-06",
          reason: id,
        })),
        updated_at: updatedAt,
      },
    });
    const stub = createSupabaseStub({
      checkup_items: [{ data: [{ id: "k-d", title: "Витамин D", status: "active" }] }],
      checkup_completions: [{ data: [] }],
      medical_records: [
        queued([], "t1"),
        { data: [] }, // the row moved on: nothing written
        queued(["k-b12"], "t2"),
        { data: [{ id: "rec-1" }] },
      ],
    });

    await proposeRecordReconciliation(stub.client, record, {
      conditions: [],
      checkups: [{ checkup_item_id: "k-d", done_at: "2026-03-06", reason: "k-d" }],
    });

    const writes = stub.argsFor("medical_records", "update");
    expect(writes).toHaveLength(2);
    expect(writes[1][0]).toEqual({
      llm_suggested_checkup_completions: [
        { checkup_item_id: "k-b12", suggested_done_at: "2026-03-06", reason: "k-b12" },
        { checkup_item_id: "k-d", suggested_done_at: "2026-03-06", reason: "k-d" },
      ],
    });
  });
});

describe("applyRecordProposals", () => {
  it("confirms the closure and records each completion once", async () => {
    const stub = createSupabaseStub(
      {
        medical_records: [
          {
            data: {
              llm_suggested_checkup_completions: [
                { checkup_item_id: "k-d", suggested_done_at: "2026-03-06", reason: "D" },
                { checkup_item_id: "k-b12", suggested_done_at: "2026-03-06", reason: "B12" },
              ],
            },
          },
          {
            data: {
              llm_suggested_checkup_completions: [
                { checkup_item_id: "k-d", suggested_done_at: "2026-03-06", reason: "D" },
                { checkup_item_id: "k-b12", suggested_done_at: "2026-03-06", reason: "B12" },
                { checkup_item_id: "k-new", suggested_done_at: "2026-03-06", reason: "meanwhile" },
              ],
              updated_at: "t2",
            },
          },
          { data: [{ id: "rec-1" }] },
        ],
        record_observations: [{ data: [B12_IN_RANGE] }],
        condition_records: [{ data: null }, { data: { status_in_record: "resolved" } }],
        conditions: [{ data: null }],
        checkup_completions: [
          { data: [{ checkup_item_id: "k-b12", done_at: "2026-03-06T00:00:00Z" }] },
          { data: null },
        ],
      },
      { get_record_conditions: { data: [B12_CLOSURE] } },
    );

    const outcome = await applyRecordProposals(stub.client, "rec-1");

    expect(stub.argsFor("checkup_completions", "insert")).toEqual([
      [{ checkup_item_id: "k-d", done_at: "2026-03-06", note: "D", evidence_record_id: "rec-1" }],
    ]);
    expect(stub.argsFor("conditions", "update")).toEqual([[{ current_status: "resolved" }]]);
    // What it applied comes off the list; what was proposed meanwhile stays for the owner.
    expect(stub.argsFor("medical_records", "update")).toEqual([
      [
        {
          llm_suggested_checkup_completions: [
            { checkup_item_id: "k-new", suggested_done_at: "2026-03-06", reason: "meanwhile" },
          ],
        },
      ],
    ]);
    expect(outcome).toEqual({ mentionsConfirmed: 1, closuresLeftPending: 0, checkupsCompleted: 1 });
  });
});

describe("dismissRecordProposals", () => {
  it("dismisses pending closures and drops the suggested completions", async () => {
    const stub = createSupabaseStub(
      {
        condition_records: [{ data: null }],
        medical_records: [
          {
            data: {
              llm_suggested_checkup_completions: [
                { checkup_item_id: "k-d", suggested_done_at: "2026-03-06", reason: "D" },
              ],
              updated_at: "t1",
            },
          },
          { data: [{ id: "rec-1" }] },
        ],
      },
      {
        get_record_conditions: {
          data: [
            B12_CLOSURE,
            { ...B12_CLOSURE, id: "cr-verified", is_user_verified: true },
            { ...B12_CLOSURE, id: "cr-active", status_in_record: "active" },
          ],
        },
      },
    );

    const outcome = await dismissRecordProposals(stub.client, "rec-1");

    expect(stub.argsFor("condition_records", "update")).toEqual([
      [{ review_decision: "dismissed" }],
    ]);
    expect(stub.argsFor("condition_records", "eq")).toEqual([["id", "cr-b12"]]);
    expect(stub.argsFor("medical_records", "update")).toEqual([
      [{ llm_suggested_checkup_completions: null }],
    ]);
    expect(outcome).toEqual({ closuresDismissed: 1, completionsDropped: 1 });
  });
});

describe("removeRecordDraft", () => {
  it("sets a record in review aside, as the app's Remove does", async () => {
    const stub = createSupabaseStub({
      medical_records: [
        { data: { id: "r-1", status: "structure_review" } },
        { data: [{ id: "r-1" }] },
      ],
    });
    expect(await removeRecordDraft(stub.client, "r-1")).toEqual({ status: "removed" });
    const [[update]] = stub.argsFor("medical_records", "update") as [[Record<string, unknown>]];
    expect(update.status).toBe("removed");
    expect(typeof update.removed_at).toBe("string");
    const [[column, statuses]] = stub.argsFor("medical_records", "in") as [[string, string[]]];
    expect(column).toBe("status");
    expect(statuses).not.toContain("active");
  });

  it("leaves a record approved between the read and the write alone", async () => {
    const stub = createSupabaseStub({
      medical_records: [
        { data: { id: "r-1", status: "structure_review" } },
        { data: [] },
        { data: { status: "active" } },
      ],
    });
    expect(await removeRecordDraft(stub.client, "r-1")).toEqual({
      status: "not_a_draft",
      recordStatus: "active",
    });
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
