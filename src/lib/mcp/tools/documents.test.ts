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
  signPageUploads: vi.fn(),
}));
const records = vi.hoisted(() => ({
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

  it("reports closures it left pending", async () => {
    documents.getIngestableRecord.mockResolvedValue({ ...RECORD, status: "structure_review" });
    documents.activateMedicalRecord.mockResolvedValue({
      droppedUnmatchedObservations: 1,
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
    expect(result.content[0].text).toContain("Dropped 1 unrecognised observation(s).");
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
