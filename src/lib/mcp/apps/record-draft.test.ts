import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The draft card is what the owner approves from, so what it must get right is the view (every row
 * the document will put on the chart, flagged and labelled as the app would) and the two calls: the
 * model can show the card but never decline a record itself.
 */
const records = vi.hoisted(() => ({
  getMedicalRecord: vi.fn(),
  getRecordConditions: vi.fn(),
  getRecordFindings: vi.fn(),
  getRecordObservations: vi.fn(),
}));
const documents = vi.hoisted(() => ({
  removeRecordDraft: vi.fn(),
  getPendingCompletions: vi.fn(),
  applyRecordProposals: vi.fn(),
  dismissRecordProposals: vi.fn(),
  signRecordPageLinks: vi.fn(),
}));
const persons = vi.hoisted(() => ({
  name: "Максим" as string | null,
  queued: [] as Array<{ id: string; title: string | null; status: string }>,
}));

vi.mock("../health/records", () => records);
vi.mock("../health/documents", () => documents);
vi.mock("../supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: persons.name ? { name: persons.name } : null }),
        }),
        in: async () => ({ data: persons.queued, error: null }),
      }),
    }),
  })),
}));

import { RECORD_DRAFT_HTML } from "./record-draft-page";
import { RECORD_DRAFT_RESOURCE_URI, buildDraftView, registerRecordDraftApp } from "./record-draft";

type Handler = (
  args: unknown,
  ctx: unknown,
) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;
type Registered = { config: Record<string, unknown>; handler: Handler };

const RECORD_ID = "22222222-2222-2222-2222-222222222222";
const ctx = {
  http: {
    authInfo: {
      scopes: ["health:read", "health:write"],
      extra: {
        grantId: "g-1",
        authUserId: "11111111-1111-1111-1111-111111111111",
        userEmail: "u@example.com",
        appOrigin: "https://orbit.test",
      },
    },
  },
};

function register() {
  const tools = new Map<string, Registered>();
  const resources = new Map<
    string,
    {
      uri: string;
      config: Record<string, unknown>;
      read: (uri: URL) => Promise<{ contents: Array<Record<string, unknown>> }>;
    }
  >();
  registerRecordDraftApp({
    registerTool: vi.fn((name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { config, handler });
      return {} as never;
    }),
    registerResource: vi.fn(
      (
        name: string,
        uri: string,
        config: Record<string, unknown>,
        read: (uri: URL) => Promise<{ contents: Array<Record<string, unknown>> }>,
      ) => {
        resources.set(name, { uri, config, read });
        return {} as never;
      },
    ),
  } as never);
  return { tools, resources };
}

const RECORD = {
  id: RECORD_ID,
  person_id: "p-1",
  title: "Общий анализ крови",
  record_type: "lab",
  record_date: "2026-10-20",
  status: "structure_review",
  llm_summary: "Ферритин снижен.",
  notes: null,
};
const OBSERVATIONS = [
  {
    obs_name: "HGB",
    catalog_name_ru: "Гемоглобин",
    value_text: "135",
    unit: "г/л",
    ref_range_low: 120,
    ref_range_high: 160,
    status: "normal",
    is_applied: true,
  },
  {
    obs_name: "Ферритин",
    catalog_name_ru: "Ферритин",
    value_text: "8",
    unit: "нг/мл",
    ref_range_text: "15–150",
    status: "low",
    is_applied: true,
  },
  { obs_name: "Странный показатель", value_text: "3", status: "critical_high", is_applied: false },
];
const FINDINGS = [
  {
    finding_type_text: "невус",
    catalog_finding_name_ru: "Невус",
    body_site_text: "спина",
    catalog_site_name_ru: "Спина",
    finding_code: "nevus",
    site_code: "back",
    size_mm: 4,
    count: 1,
    severity: "mild",
    laterality: "left",
    description: "Ровные края, однородный цвет",
    histology: "Пограничный невус",
  },
  { finding_type_text: "пятно", body_site_text: "плечо", finding_code: "spot", site_code: null },
];
const CONDITIONS = [
  {
    condition_name: "Железодефицит",
    condition_code: "D50",
    status_in_record: "active",
    is_proposal: true,
  },
  {
    condition_name: "Дефицит B12",
    status_in_record: "resolved",
    supporting_obs_code: "vitamin_b12",
    awaiting_confirmation: true,
  },
  {
    condition_name: "Гастрит",
    status_in_record: "resolved",
    awaiting_confirmation: false,
    not_applied_reason: "dismissed",
  },
];

describe("buildDraftView", () => {
  const view = buildDraftView({
    record: RECORD,
    personName: "Максим",
    observations: OBSERVATIONS,
    findings: FINDINGS,
    conditions: CONDITIONS,
    reviewUrl: "https://orbit.test/health/records/r",
  });

  it("labels the record as the app does", () => {
    expect(view).toMatchObject({
      title: "Общий анализ крови",
      type_label: "Анализы",
      person_name: "Максим",
      summary: "Ферритин снижен.",
      status: "structure_review",
    });
  });

  it("flags out-of-range values and marks the ones the catalogue does not know", () => {
    expect(view.observations).toEqual([
      {
        name: "Гемоглобин",
        value: "135 г/л",
        ref: "120–160",
        flag: null,
        critical: false,
        recognised: true,
      },
      {
        name: "Ферритин",
        value: "8 нг/мл",
        ref: "15–150",
        flag: "low",
        critical: false,
        recognised: true,
      },
      {
        name: "Странный показатель",
        value: "3",
        ref: null,
        flag: "high",
        critical: true,
        recognised: false,
      },
    ]);
  });

  it("describes findings in words, and an uncoded site as not recognised", () => {
    expect(view.findings).toEqual([
      {
        name: "Невус",
        site: "Спина",
        details: "4 мм, лёгкая, слева",
        description: "Ровные края, однородный цвет",
        histology: "Пограничный невус",
        recognised: true,
      },
      {
        name: "пятно",
        site: "плечо",
        details: null,
        description: null,
        histology: null,
        recognised: false,
      },
    ]);
  });

  it("puts closures awaiting confirmation apart and leaves out dismissed ones", () => {
    expect(view.conditions).toEqual([
      { name: "Железодефицит", code: "D50", status: "активный", proposed: true },
    ]);
    expect(view.closures).toEqual([
      { name: "Дефицит B12", status: "разрешён", evidence: "vitamin_b12" },
    ]);
  });

  it("says what a closure sets the diagnosis to, history apart from resolved", () => {
    const history = buildDraftView({
      record: RECORD,
      personName: null,
      observations: [],
      findings: [],
      conditions: [
        { condition_name: "Ветрянка", status_in_record: "history", awaiting_confirmation: true },
      ],
      reviewUrl: null,
    });
    expect(history.closures).toEqual([{ name: "Ветрянка", status: "в анамнезе", evidence: null }]);
  });

  it("names the measurement a closure cites when the record carries it", () => {
    const cited = buildDraftView({
      record: RECORD,
      personName: null,
      observations: [
        {
          obs_code: "vitamin_b12",
          catalog_name_ru: "Витамин B12",
          value_text: "412",
          is_applied: true,
        },
      ],
      findings: [],
      conditions: CONDITIONS,
      reviewUrl: null,
    });
    expect(cited.closures).toEqual([
      { name: "Дефицит B12", status: "разрешён", evidence: "Витамин B12" },
    ]);
  });

  it("asks to confirm proposals only for an approved record that has some", () => {
    const build = (status: string, conditions: Array<Record<string, unknown>>) =>
      buildDraftView({
        record: { ...RECORD, status },
        personName: null,
        observations: [],
        findings: [],
        conditions,
        reviewUrl: null,
      }).has_proposals;

    expect(build("structure_review", CONDITIONS)).toBe(false);
    expect(build("active", CONDITIONS)).toBe(true);
    expect(build("active", [CONDITIONS[0]])).toBe(false);
  });
});

describe("registerRecordDraftApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persons.name = "Максим";
    records.getMedicalRecord.mockResolvedValue(RECORD);
    records.getRecordObservations.mockResolvedValue(OBSERVATIONS);
    records.getRecordFindings.mockResolvedValue(FINDINGS);
    records.getRecordConditions.mockResolvedValue(CONDITIONS);
    documents.getPendingCompletions.mockResolvedValue([]);
    documents.signRecordPageLinks.mockResolvedValue([]);
  });

  it("links show_record_draft to the card and keeps decline away from the model", () => {
    const { tools, resources } = register();

    expect(resources.get("orbit-record-draft")).toMatchObject({
      uri: RECORD_DRAFT_RESOURCE_URI,
      config: { mimeType: "text/html;profile=mcp-app" },
    });
    expect(tools.get("show_record_draft")!.config._meta).toEqual({
      ui: { resourceUri: RECORD_DRAFT_RESOURCE_URI },
      "ui/resourceUri": RECORD_DRAFT_RESOURCE_URI,
    });
    expect(tools.get("show_record_draft")!.config.annotations).toMatchObject({
      readOnlyHint: true,
    });
    for (const name of [
      "decline_record_draft",
      "confirm_record_proposals",
      "dismiss_record_proposals",
    ]) {
      expect(tools.get(name)!.config._meta).toEqual({ ui: { visibility: ["app"] } });
    }
  });

  it("asks the owner to confirm what was proposed for an approved record", async () => {
    records.getMedicalRecord.mockResolvedValue({ ...RECORD, status: "active" });
    documents.getPendingCompletions.mockResolvedValue([
      { checkup_item_id: "k-1", title: "Витамин D", done_at: "2026-10-20", reason: "в бланке" },
    ]);
    const result = await register()
      .tools.get("show_record_draft")!
      .handler({ record_id: RECORD_ID }, ctx);

    expect(result.content[0].text).toContain("1 checkup completion(s) awaiting confirmation");
    expect(result.content[0].text).toContain("Nothing has changed on the chart until they confirm");
    expect(result.structuredContent?.draft).toMatchObject({
      has_proposals: true,
      completions: [{ title: "Витамин D", done_at: "2026-10-20", reason: "в бланке" }],
    });
  });

  it("confirms and declines proposals only on an approved record", async () => {
    const { tools } = register();
    const confirm = tools.get("confirm_record_proposals")!.handler;
    const dismiss = tools.get("dismiss_record_proposals")!.handler;

    const refused = await confirm({ record_id: RECORD_ID }, ctx);
    expect(refused.isError).toBe(true);
    expect(documents.applyRecordProposals).not.toHaveBeenCalled();

    records.getMedicalRecord.mockResolvedValue({ ...RECORD, status: "active" });
    documents.applyRecordProposals.mockResolvedValue({
      mentionsConfirmed: 2,
      closuresLeftPending: 0,
      checkupsCompleted: 8,
    });
    const confirmed = await confirm({ record_id: RECORD_ID }, ctx);
    expect(confirmed.content[0].text).toContain("2 closure(s), 8 checkup(s) marked done");

    documents.dismissRecordProposals.mockResolvedValue({
      closuresDismissed: 1,
      completionsDropped: 0,
    });
    const dismissed = await dismiss({ record_id: RECORD_ID }, ctx);
    expect(dismissed.content[0].text).toContain("The record stays approved");
    expect(dismissed.structuredContent).toMatchObject({ status: "active", closuresDismissed: 1 });
  });

  it("returns the draft view and tells the model to wait for the owner", async () => {
    const result = await register()
      .tools.get("show_record_draft")!
      .handler({ record_id: RECORD_ID }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Showing the draft of "Общий анализ крови"');
    expect(result.content[0].text).toContain("posts a short message from them in the chat");
    expect(result.structuredContent?.draft).toMatchObject({
      record_id: RECORD_ID,
      person_name: "Максим",
      review_url: `https://orbit.test/health/records/${RECORD_ID}`,
    });
  });

  it("hands the card the document's pages, and lets the host load them from storage", async () => {
    const page = {
      name: "scan-1.jpg",
      mime_type: "image/jpeg",
      url: "https://orbit.test/storage/v1/object/sign/medical-attachments/p/r/1-scan-1.jpg?token=t",
    };
    documents.signRecordPageLinks.mockResolvedValue([page]);
    const { tools, resources } = register();
    const result = await tools.get("show_record_draft")!.handler({ record_id: RECORD_ID }, ctx);

    expect(documents.signRecordPageLinks).toHaveBeenCalledWith(expect.anything(), RECORD_ID);
    expect(result.structuredContent?.draft).toMatchObject({ pages: [page] });

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://orbit.test");
    try {
      const read = await resources
        .get("orbit-record-draft")!
        .read(new URL(RECORD_DRAFT_RESOURCE_URI));
      expect(read.contents[0]._meta).toEqual({
        ui: { csp: { resourceDomains: ["https://orbit.test"] } },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("queues further drafts on the same card, leaving out ones already decided", async () => {
    const second = "22222222-2222-4222-8222-222222222222";
    const decided = "33333333-3333-4333-8333-333333333333";
    persons.queued = [
      { id: decided, title: "УЗИ", status: "active" },
      { id: second, title: "Биохимия", status: "structure_review" },
    ];
    const result = await register()
      .tools.get("show_record_draft")!
      .handler({ record_id: RECORD_ID, then_record_ids: [second, decided, RECORD_ID] }, ctx);

    expect(result.structuredContent?.queue).toEqual([
      { record_id: RECORD_ID, title: "Общий анализ крови" },
      { record_id: second, title: "Биохимия" },
    ]);
    expect(result.content[0].text).toContain('goes through 1 more draft(s): "Биохимия"');
    persons.queued = [];
  });

  it("refuses a record that has not been ingested yet", async () => {
    records.getMedicalRecord.mockResolvedValue({ ...RECORD, status: "draft" });
    const result = await register()
      .tools.get("show_record_draft")!
      .handler({ record_id: RECORD_ID }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Call ingest_medical_document first");
  });

  it("declines a draft, and refuses an approved record", async () => {
    const decline = register().tools.get("decline_record_draft")!.handler;

    documents.removeRecordDraft.mockResolvedValueOnce({ status: "removed" });
    const removed = await decline({ record_id: RECORD_ID }, ctx);
    expect(removed.isError).toBeUndefined();
    expect(removed.structuredContent).toEqual({ record_id: RECORD_ID, status: "removed" });

    documents.removeRecordDraft.mockResolvedValueOnce({
      status: "not_a_draft",
      recordStatus: "active",
    });
    const refused = await decline({ record_id: RECORD_ID }, ctx);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("is active");
  });

  it("needs write access to decline", async () => {
    const readOnly = {
      http: { authInfo: { ...ctx.http.authInfo, scopes: ["health:read"] } },
    };
    const result = await register()
      .tools.get("decline_record_draft")!
      .handler({ record_id: RECORD_ID }, readOnly);

    expect(result.isError).toBe(true);
    expect(documents.removeRecordDraft).not.toHaveBeenCalled();
  });
});

describe("RECORD_DRAFT_HTML", () => {
  it("starts the model's turn with a chat message after a decision", () => {
    // Model context alone does not start a turn, so each outcome also posts a line in the chat.
    expect(RECORD_DRAFT_HTML).toContain('request("ui/message", { role: "user"');
    for (const line of [
      "Одобрил запись «",
      "Отклонил запись «",
      "Подтвердил сверку",
      "Отклонил сверку: «",
      "Добавил в расписание: ",
    ]) {
      expect(RECORD_DRAFT_HTML).toContain(line);
    }
  });

  it("leaves full screen before it writes to the chat", () => {
    // Sent from full screen, the message opens the chat in a sheet over the card.
    expect(RECORD_DRAFT_HTML).toContain(
      'leaveFullscreen().then(function () {\n      request("ui/message"',
    );
    expect(RECORD_DRAFT_HTML).toContain('request("ui/request-display-mode", { mode: "inline" }');
    expect(RECORD_DRAFT_HTML.match(/request\("ui\/message"/g)).toHaveLength(1);
  });

  it("holds the chat message for a queue until the owner is through it", () => {
    expect(RECORD_DRAFT_HTML).toContain("Разобрал записи в карточке: ");
    expect(RECORD_DRAFT_HTML).toContain('if (!noteOutcome("approved")) tellChat(');
    expect(RECORD_DRAFT_HTML).toContain('" из " + queue.length');
  });

  it("never strands a queue: a failed load can be retried and the last draft can always finish", () => {
    expect(RECORD_DRAFT_HTML).toContain('"Повторить"');
    expect(RECORD_DRAFT_HTML).toContain("if (failed && inQueue() && !queueDone)");
    expect(RECORD_DRAFT_HTML).toContain(
      "if (inQueue() && !queueDone) footer.appendChild(queueActions());",
    );
    expect(RECORD_DRAFT_HTML).toContain('kind: "already"');
  });

  it("keeps the queued ids when the card fetches its own draft", () => {
    expect(RECORD_DRAFT_HTML).toContain("thenRecordIds = args.then_record_ids");
    expect(RECORD_DRAFT_HTML).toContain("then_record_ids: thenRecordIds");
  });

  it("ships a script that parses", () => {
    // The page is a template literal, so one wrong escape breaks the whole card with no other sign.
    const start = RECORD_DRAFT_HTML.indexOf("<script>") + "<script>".length;
    const script = RECORD_DRAFT_HTML.slice(start, RECORD_DRAFT_HTML.lastIndexOf("</script>"));
    expect(() => new Function(script)).not.toThrow();
  });

  it("never turns document text into markup", () => {
    expect(RECORD_DRAFT_HTML).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it("approves through activate_medical_record and declines through the card-only tool", () => {
    const calls = RECORD_DRAFT_HTML.match(/run\("(approve|decline|confirm|dismiss)", "[a-z_]+"\)/g);
    expect(calls).toEqual([
      'run("confirm", "confirm_record_proposals")',
      'run("approve", "activate_medical_record")',
      'run("dismiss", "dismiss_record_proposals")',
      'run("decline", "decline_record_draft")',
    ]);
  });

  it("asks before declining", () => {
    expect(RECORD_DRAFT_HTML).toContain("Да, отклонить");
  });

  it("hands only a failed approve to Claude, which cannot decline", () => {
    expect(RECORD_DRAFT_HTML).toContain('decision.action === "approve")');
    expect(RECORD_DRAFT_HTML).not.toContain("Отклони черновик");
  });

  it("reports its height to the host and clears the full-screen header", () => {
    expect(RECORD_DRAFT_HTML).toContain('method: "ui/notifications/size-changed"');
    expect(RECORD_DRAFT_HTML).toContain("document.documentElement.getBoundingClientRect().height");
    expect(RECORD_DRAFT_HTML).toContain("hostContext.safeAreaInsets");
  });
});
