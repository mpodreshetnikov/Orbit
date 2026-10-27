import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

/**
 * The document tools are a thin wrapper around `health-ingest` and the activation rules; what they
 * own is refusing the calls that must not reach the server, and saying in the text block everything
 * the server decided -- an agent reads that block, not the structured payload.
 */
const documents = vi.hoisted(() => ({
  ALLOWED_PAGE_MIME_TYPES: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "application/pdf",
  ],
  MAX_PAGE_BYTES: 20 * 1024 * 1024,
  activateMedicalRecord: vi.fn(),
  createDraftRecord: vi.fn(),
  dismissConditionClosure: vi.fn(),
  findMissingPages: vi.fn(),
  getIngestCandidates: vi.fn(),
  getIngestableRecord: vi.fn(),
  getRecordExtractionIssues: vi.fn(),
  isIngestableStatus: vi.fn((status: string) => status !== "active"),
  proposeRecordReconciliation: vi.fn(),
  recordPageSizes: vi.fn(),
  removeRecordDraft: vi.fn(),
  signPageUploads: vi.fn(),
  suggestReconciliation: vi.fn(),
}));
const records = vi.hoisted(() => ({
  getMedicalRecord: vi.fn(),
  getRecordConditions: vi.fn(),
  getRecordFindings: vi.fn(),
  getRecordObservations: vi.fn(),
}));
const userClient = vi.hoisted(() => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
  invokeEdgeFunctionAsUser: vi.fn(),
}));

vi.mock("../health/documents", () => documents);
vi.mock("../health/records", () => records);
vi.mock("../supabase-user-client", () => userClient);
vi.mock("../resolve-person", () => ({
  resolvePerson: vi.fn(async () => ({
    status: "ok",
    person: { id: "p-1", name: "Max", kind: "human" },
  })),
}));

type Handler = (
  args: unknown,
  ctx: unknown,
) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const ctx = {
  http: {
    authInfo: {
      scopes: ["health:read", "health:write"],
      extra: {
        grantId: "g-1",
        authUserId: "11111111-1111-1111-1111-111111111111",
        userEmail: "u@example.com",
      },
    },
  },
};

const RECORD_ID = "22222222-2222-2222-2222-222222222222";
const RECORD = {
  id: RECORD_ID,
  person_id: "p-1",
  status: "draft",
  title: "Витамины",
  attachments: [
    {
      id: "a-1",
      original_filename: "page1.jpg",
      storage_path: "p-1/r/1-page1.jpg",
      mime_type: "image/jpeg",
    },
  ],
};

const SUBMISSION = {
  record_id: RECORD_ID,
  source_text: "Витамин В12 704 пг/мл (197-771)",
  classification: {
    record_type: "lab",
    title: "Витамины",
    record_date: "2025-10-27",
    summary: "",
    keywords: [],
  },
  extraction: { observations: [], findings: [], conditions: [], asserted_absences: [] },
  reconciliation: { nothing_to_reconcile: true },
};

const B12_CONDITION = {
  kind: "condition",
  id: "33333333-3333-3333-3333-333333333333",
  label: "Недостаточность витамина B12 [E53.8] (active)",
  reason: "this document measures vitamin B12, which decides it",
};
const ULTRASOUND = {
  kind: "checkup",
  id: "44444444-4444-4444-4444-444444444444",
  label: "УЗИ брюшной полости (imaging), due 2026-03-01",
  reason: "due in the period this document dates from",
};

async function handlers(): Promise<Map<string, Handler>> {
  const { registerDocumentTools } = await import("./documents");
  const map = new Map<string, Handler>();
  registerDocumentTools({
    registerTool: vi.fn((name: string, _config: unknown, handler: Handler) => {
      map.set(name, handler);
      return {} as never;
    }),
  } as unknown as McpToolServer);
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
  documents.getIngestableRecord.mockResolvedValue(RECORD);
  documents.findMissingPages.mockResolvedValue([]);
  documents.getRecordExtractionIssues.mockResolvedValue([]);
  documents.suggestReconciliation.mockResolvedValue({ suggestions: [], alsoDue: [] });
  records.getRecordObservations.mockResolvedValue([]);
  records.getRecordFindings.mockResolvedValue([]);
  records.getRecordConditions.mockResolvedValue([]);
});

describe("create_medical_record", () => {
  it("returns an upload command per page in the text block", async () => {
    documents.createDraftRecord.mockResolvedValue({
      recordId: RECORD_ID,
      uploads: [
        {
          attachment_id: "a-1",
          filename: "page1.jpg",
          mime_type: "image/jpeg",
          storage_path: "p-1/r/1-page1.jpg",
          upload_url: "https://orbit.test/upload?token=t",
        },
      ],
    });
    const tool = (await handlers()).get("create_medical_record")!;
    const result = await tool(
      {
        record_type: "lab",
        title: "Витамины",
        pages: [{ filename: "page1.jpg", mime_type: "image/jpeg" }],
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(documents.createDraftRecord.mock.calls[0][1]).toMatchObject({
      personId: "p-1",
      userId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.content[0].text).toContain(RECORD_ID);
    expect(result.content[0].text).toContain(
      'curl -sS -X PUT -H "Content-Type: image/jpeg" --data-binary @"<local path to page1.jpg>" "https://orbit.test/upload?token=t"',
    );
  });
});

describe("ingest_medical_document", () => {
  it("refuses a record a person has already approved, without calling the server", async () => {
    documents.getIngestableRecord.mockResolvedValue({ ...RECORD, status: "active" });
    const result = await (await handlers()).get("ingest_medical_document")!(SUBMISSION, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("is active");
    expect(userClient.invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("refuses a submission that has not decided what the document closes, storing nothing", async () => {
    documents.suggestReconciliation.mockResolvedValue({
      suggestions: [B12_CONDITION],
      alsoDue: [ULTRASOUND],
    });
    const { reconciliation: _omitted, ...undecided } = SUBMISSION;
    void _omitted;
    const result = await (await handlers()).get("ingest_medical_document")!(undecided, ctx);
    const text = result.content[0].text;

    expect(result.isError).toBe(true);
    expect(text).toContain("Not ingested: decide what this document closes first");
    expect(text).toContain(`condition_id ${B12_CONDITION.id}`);
    expect(text).toContain(`checkup_item_id ${ULTRASOUND.id}`);
    expect(text).toContain("nothing_to_reconcile: true");
    expect(text).toContain("extraction.conditions");
    expect(userClient.invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
    expect(documents.suggestReconciliation).toHaveBeenCalledWith(expect.anything(), "p-1", {
      recordDate: "2025-10-27",
      sourceText: SUBMISSION.source_text,
      observationLabels: [],
    });
  });

  it("refuses the flag when it leaves a suggestion unruled", async () => {
    documents.suggestReconciliation.mockResolvedValue({
      suggestions: [B12_CONDITION],
      alsoDue: [],
    });
    const result = await (await handlers()).get("ingest_medical_document")!(SUBMISSION, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("reconciliation does not rule on them");
    expect(userClient.invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("refuses an empty decision that does not say nothing applies", async () => {
    const result = await (await handlers()).get("ingest_medical_document")!(
      { ...SUBMISSION, reconciliation: {} },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not say that nothing applies");
    expect(userClient.invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("passes the closures on and keeps its own rulings out of the edge call", async () => {
    documents.suggestReconciliation.mockResolvedValue({
      suggestions: [B12_CONDITION],
      alsoDue: [],
    });
    userClient.invokeEdgeFunctionAsUser.mockResolvedValue({
      status: 200,
      payload: { success: true },
    });
    const closure = {
      condition_id: B12_CONDITION.id,
      supporting_obs_code: "vitamin_b12",
      reason: "B12 704 in range",
      source_anchor: "Витамин В12 704",
    };
    const result = await (await handlers()).get("ingest_medical_document")!(
      {
        ...SUBMISSION,
        reconciliation: {
          conditions_to_resolve: [closure],
          not_applicable: [{ id: ULTRASOUND.id, reason: "a lab cannot complete an ultrasound" }],
        },
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(userClient.invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      expect.anything(),
      "health-ingest",
      expect.objectContaining({
        reconciliation: {
          conditions_to_resolve: [closure],
          findings_to_resolve: [],
          checkups_to_complete: [],
        },
      }),
    );
    expect(result.content[0].text).toContain(
      `Ruled out by you: ${ULTRASOUND.id} (a lab cannot complete an ultrasound).`,
    );
  });

  it("hands out fresh links for pages that never arrived, without calling the server", async () => {
    documents.findMissingPages.mockResolvedValue(RECORD.attachments);
    documents.signPageUploads.mockResolvedValue([
      {
        attachment_id: "a-1",
        filename: "page1.jpg",
        mime_type: "image/jpeg",
        storage_path: "p-1/r/1-page1.jpg",
        upload_url: "https://orbit.test/fresh",
      },
    ]);
    const result = await (await handlers()).get("ingest_medical_document")!(SUBMISSION, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("1 of 1 page(s)");
    expect(result.content[0].text).toContain("https://orbit.test/fresh");
    expect(userClient.invokeEdgeFunctionAsUser).not.toHaveBeenCalled();
  });

  it("records the uploaded pages' sizes before handing the document to the server", async () => {
    userClient.invokeEdgeFunctionAsUser.mockResolvedValue({
      status: 200,
      payload: { success: true, rejected: [] },
    });
    await (await handlers()).get("ingest_medical_document")!(SUBMISSION, ctx);

    expect(documents.recordPageSizes).toHaveBeenCalledWith(expect.anything(), RECORD);
  });

  it("says in the text block what was stored, refused, unrecognised and pending", async () => {
    userClient.invokeEdgeFunctionAsUser.mockResolvedValue({
      status: 200,
      payload: {
        success: true,
        rejected: [
          { entityKind: "observation", reason: "source anchor not found in document text" },
        ],
        dropped_condition_resolutions: [
          { entityKind: "condition_to_resolve", reason: "cited observation is out of range" },
        ],
      },
    });
    records.getRecordObservations.mockResolvedValue([
      { obs_name: "Витамин В12", value_text: "704", unit: "пг/мл", is_applied: true },
      { obs_name: "Гомоцистеин", value_text: "9", unit: "мкмоль/л", is_applied: false },
    ]);
    records.getRecordConditions.mockResolvedValue([
      {
        id: "cr-1",
        condition_name: "Недостаточность B12",
        status_in_record: "resolved",
        supporting_obs_code: "vitamin_b12",
        awaiting_confirmation: true,
      },
    ]);
    documents.getRecordExtractionIssues.mockResolvedValue([
      {
        entity_kind: "record",
        field: "record.record_date",
        resolution: "replaced_with_default",
        received: "март",
      },
    ]);

    const result = await (await handlers()).get("ingest_medical_document")!(SUBMISSION, ctx);
    const text = result.content[0].text;

    expect(userClient.invokeEdgeFunctionAsUser).toHaveBeenCalledWith(
      expect.objectContaining({ authUserId: "11111111-1111-1111-1111-111111111111" }),
      "health-ingest",
      expect.objectContaining({ record_id: RECORD_ID, source_text: SUBMISSION.source_text }),
    );
    expect(result.isError).toBeUndefined();
    expect(text).toContain("Stored 2 observation(s), 0 finding(s), 1 diagnosis mention(s).");
    expect(text).toContain("- Гомоцистеин 9 мкмоль/л");
    expect(text).toContain(
      "Недостаточность B12 → resolved, citing vitamin_b12 (condition_record_id cr-1)",
    );
    expect(text).toContain("- observation: source anchor not found in document text");
    expect(text).toContain("- condition_to_resolve: cited observation is out of range");
    expect(text).toContain("record.record_date: replaced_with_default (received март)");
  });

  it("points to the draft card next, with the review link as the fallback when the origin is known", async () => {
    userClient.invokeEdgeFunctionAsUser.mockResolvedValue({
      status: 200,
      payload: { success: true },
    });
    const withOrigin = {
      http: {
        authInfo: {
          ...ctx.http.authInfo,
          extra: { ...ctx.http.authInfo.extra, appOrigin: "https://orbit.test" },
        },
      },
    };
    const tool = (await handlers()).get("ingest_medical_document")!;

    const linked = await tool(SUBMISSION, withOrigin);
    expect(linked.content[0].text).toContain("Next: call show_record_draft");
    expect(linked.content[0].text).toContain(`https://orbit.test/health/records/${RECORD_ID}`);
    expect(linked.structuredContent?.review_url).toBe(
      `https://orbit.test/health/records/${RECORD_ID}`,
    );

    const unlinked = await tool(SUBMISSION, ctx);
    expect(unlinked.content[0].text).toContain("Next: call show_record_draft");
    expect(unlinked.content[0].text).not.toContain("/health/records/");
    expect(unlinked.structuredContent?.review_url).toBeNull();
  });

  it("names the findings the catalogues did not code", async () => {
    userClient.invokeEdgeFunctionAsUser.mockResolvedValue({
      status: 200,
      payload: { success: true },
    });
    records.getRecordFindings.mockResolvedValue([
      {
        finding_type_text: "Конкременты",
        finding_code: "CALCULUS",
        body_site_text: "почка",
        site_code: "kidney",
      },
      {
        finding_type_text: "Высыпания",
        finding_code: null,
        body_site_text: "спина",
        site_code: null,
      },
    ]);
    const text = (await (await handlers()).get("ingest_medical_document")!(SUBMISSION, ctx))
      .content[0].text;

    expect(text).toContain("Findings the catalogues did not recognise");
    expect(text).toContain("- Высыпания (no finding type) at спина (no body site)");
    expect(text).not.toContain("- Конкременты");
  });

  it("relays the server's refusal", async () => {
    userClient.invokeEdgeFunctionAsUser.mockResolvedValue({
      status: 409,
      payload: { success: false, error: "Structuring is already running for this record" },
    });
    const result = await (await handlers()).get("ingest_medical_document")!(SUBMISSION, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 409");
    expect(result.content[0].text).toContain("already running");
  });
});

describe("activate_medical_record", () => {
  it("only approves a record that is in review", async () => {
    const result = await (await handlers()).get("activate_medical_record")!(
      { record_id: RECORD_ID },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(documents.activateMedicalRecord).not.toHaveBeenCalled();
  });

  it("answers an already approved record without an error and without approving again", async () => {
    documents.getIngestableRecord.mockResolvedValue({ ...RECORD, status: "active" });
    records.getMedicalRecord.mockResolvedValue({ updated_at: "2026-10-26T10:12:32.024Z" });
    const result = await (await handlers()).get("activate_medical_record")!(
      { record_id: RECORD_ID },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(
      "is already approved (last changed 2026-10-26 10:12 UTC)",
    );
    expect(documents.activateMedicalRecord).not.toHaveBeenCalled();
  });

  it("reports closures it left pending", async () => {
    documents.getIngestableRecord.mockResolvedValue({ ...RECORD, status: "structure_review" });
    documents.activateMedicalRecord.mockResolvedValue({
      keptUnmatchedObservations: 1,
      proposalsMaterialized: 0,
      proposalsSkipped: 0,
      mentionsConfirmed: 0,
      closuresLeftPending: 1,
      checkupsCompleted: 0,
    });
    const result = await (await handlers()).get("activate_medical_record")!(
      { record_id: RECORD_ID },
      ctx,
    );
    expect(result.content[0].text).toContain(
      "Kept 1 unrecognised observation(s) on the record, outside every history.",
    );
    expect(result.content[0].text).toContain("1 closure(s) left awaiting confirmation");
  });
});

describe("dismiss_condition_closure", () => {
  it("refuses a mention that is not an unconfirmed closure", async () => {
    documents.dismissConditionClosure.mockResolvedValue({ status: "not_a_pending_closure" });
    const result = await (await handlers()).get("dismiss_condition_closure")!(
      { condition_record_id: RECORD_ID },
      ctx,
    );
    expect(result.isError).toBe(true);
  });
});

describe("propose_reconciliation", () => {
  const ACTIVE = {
    id: RECORD_ID,
    person_id: "p-1",
    title: "Витамины",
    status: "active",
    record_date: "2026-03-06",
    ocr_text: "Витамин B12 704 пг/мл",
  };

  it("is only for an approved record", async () => {
    records.getMedicalRecord.mockResolvedValue({ ...ACTIVE, status: "structure_review" });
    const result = await (await handlers()).get("propose_reconciliation")!(
      { record_id: RECORD_ID, checkups_to_complete: [{ checkup_item_id: "k", reason: "r" }] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ingest_medical_document's reconciliation");
    expect(documents.proposeRecordReconciliation).not.toHaveBeenCalled();
  });

  it("dates a completion by the record and says nothing changes before the owner confirms", async () => {
    records.getMedicalRecord.mockResolvedValue(ACTIVE);
    documents.proposeRecordReconciliation.mockResolvedValue({
      proposedClosures: 1,
      proposedCompletions: 1,
      refused: [{ id: "k-2", reason: "Витамин D was already done on 2026-03-10" }],
    });
    const result = await (await handlers()).get("propose_reconciliation")!(
      {
        record_id: RECORD_ID,
        conditions_to_resolve: [
          {
            condition_id: B12_CONDITION.id,
            source_anchor: "Витамин B12 704",
            supporting_obs_code: "vitamin_b12",
          },
        ],
        checkups_to_complete: [
          { checkup_item_id: "k-1", reason: "B12 in the report" },
          { checkup_item_id: "k-2", done_at: "2026-03-07", reason: "D in the report" },
        ],
      },
      ctx,
    );

    expect(documents.proposeRecordReconciliation.mock.calls[0][2]).toEqual({
      conditions: [
        {
          condition_id: B12_CONDITION.id,
          status: "resolved",
          source_anchor: "Витамин B12 704",
          supporting_obs_code: "vitamin_b12",
        },
      ],
      checkups: [
        { checkup_item_id: "k-1", done_at: "2026-03-06", reason: "B12 in the report" },
        { checkup_item_id: "k-2", done_at: "2026-03-07", reason: "D in the report" },
      ],
    });
    const text = result.content[0].text;
    expect(text).toContain("1 closure(s), 1 checkup completion(s)");
    expect(text).toContain("k-2: Витамин D was already done on 2026-03-10");
    expect(text).toContain("Call show_record_draft now");
  });

  it("refuses an empty proposal before loading anything", async () => {
    const result = await (await handlers()).get("propose_reconciliation")!(
      { record_id: RECORD_ID },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(records.getMedicalRecord).not.toHaveBeenCalled();
  });
});

describe("get_upload_links", () => {
  it("signs fresh links for the pages still missing, on the same record", async () => {
    documents.findMissingPages.mockResolvedValue(RECORD.attachments);
    documents.signPageUploads.mockResolvedValue([
      {
        attachment_id: "a-1",
        filename: "page1.jpg",
        mime_type: "image/jpeg",
        storage_path: "p-1/r/1-page1.jpg",
        upload_url: "https://orbit.test/fresh",
      },
    ]);
    const result = await (await handlers()).get("get_upload_links")!({ record_id: RECORD.id }, ctx);

    expect(result.isError).toBeFalsy();
    expect(documents.signPageUploads).toHaveBeenCalledWith(expect.anything(), RECORD.attachments);
    expect(result.content[0].text).toContain("https://orbit.test/fresh");
    expect(result.content[0].text).toContain(`record_id ${RECORD.id}`);
  });

  it("says to ingest when every page is already there", async () => {
    const result = await (await handlers()).get("get_upload_links")!({ record_id: RECORD.id }, ctx);

    expect(result.isError).toBeFalsy();
    expect(documents.signPageUploads).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("are uploaded. Call ingest_medical_document");
  });

  it("refuses an approved record", async () => {
    documents.getIngestableRecord.mockResolvedValue({ ...RECORD, status: "active" });
    const result = await (await handlers()).get("get_upload_links")!({ record_id: RECORD.id }, ctx);

    expect(result.isError).toBe(true);
    expect(documents.findMissingPages).not.toHaveBeenCalled();
  });
});

describe("remove_medical_record", () => {
  it("sets an unapproved record aside, restorable in the app", async () => {
    documents.removeRecordDraft.mockResolvedValue({ status: "removed" });
    const result = await (await handlers()).get("remove_medical_record")!(
      { record_id: RECORD.id },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("can be restored in the app");
  });

  it("refuses an approved record and says where it is taken off the chart", async () => {
    documents.removeRecordDraft.mockResolvedValue({
      status: "not_a_draft",
      recordStatus: "active",
    });
    const result = await (await handlers()).get("remove_medical_record")!(
      { record_id: RECORD.id },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("is active");
  });
});
