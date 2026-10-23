// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { createHealthIngestHandler } from "./handler.ts";
import type { HealthStructureRepository } from "../health-structure/repository.ts";

// The submission an MCP client makes after reading the pages itself. Everything downstream of the
// parse is the production service, so these tests drive the real resolution, conversion and gates
// against an in-memory repository.

const DOCUMENT = [
  "Лабораторное исследование 27.10.2025",
  "Витамин В12 704 пг/мл (197-771)",
  "УЗИ почек: в почках конкременты не выявлены.",
].join("\n");

interface State {
  updates: Array<Record<string, unknown>>;
  observationRows: Record<string, unknown>[];
  insertedFindings: Record<string, unknown>[];
  conditionRecords: Record<string, unknown>[];
}

function repositoryMock(options: { user?: { id: string; email: string | null } | null } = {}) {
  const state: State = {
    updates: [],
    observationRows: [],
    insertedFindings: [],
    conditionRecords: [],
  };
  const repository = {
    authenticateAllowedUser: async () =>
      options.user !== undefined ? options.user : { id: "user-1", email: "owner@example.com" },
    getRecord: async () => ({
      id: "record-1",
      person_id: "person-1",
      ocr_text: null,
      status: "draft",
    }),
    getAttachments: async () => [],
    downloadAttachment: async () => null,
    fetchObservationCatalog: async () => [
      {
        id: "obs-b12",
        obs_code: "vitamin_b12",
        name_ru: "Витамин B12",
        name_en: "Vitamin B12",
        canonical_unit: "pmol/L",
        synonyms_ru: ["Витамин В12", "Кобаламин"],
        synonyms_en: [],
        accepted_units: { "пг/мл": { factor_to_canonical: 0.738 } },
      },
    ],
    fetchFindingTypeCatalog: async () => [
      {
        id: "ft-stone",
        finding_code: "CALCULUS",
        name_ru: "Конкременты",
        name_en: "Calculus",
        synonyms_ru: ["конкремент"],
        synonyms_en: [],
      },
    ],
    fetchBodySiteCatalog: async () => [
      {
        id: "bs-kidney",
        site_code: "kidney",
        name_ru: "Почки",
        name_en: "Kidneys",
        parent_site_code: null,
        synonyms_ru: ["почках", "почек"],
        synonyms_en: [],
      },
      {
        id: "bs-kidney-right",
        site_code: "kidney_right",
        name_ru: "Правая почка",
        name_en: "Right kidney",
        parent_site_code: "kidney",
        synonyms_ru: [],
        synonyms_en: [],
      },
    ],
    fetchPersonConditions: async () => [
      {
        id: "cond-b12",
        name: "Недостаточность витамина B12",
        code: "E53.8",
        current_status: "active",
        onset_date: null,
        resolved_date: null,
      },
    ],
    fetchPersonActiveFindings: async () => [
      {
        finding_code: "CALCULUS",
        finding_type_text: "Конкременты",
        site_code: "kidney_right",
        body_site_text: "правая почка",
        finding_type_id: "ft-stone",
        body_site_id: "bs-kidney-right",
      },
    ],
    fetchUpcomingOverdueCheckupItems: async () => [],
    claimRecord: async () => "run-1",
    renewClaim: async () => true,
    updateMedicalRecord: async (_id: string, patch: Record<string, unknown>) => {
      state.updates.push(patch);
    },
    replaceRecordObservations: async (_id: string, rows: Record<string, unknown>[]) => {
      state.observationRows = rows;
    },
    replaceRecordFindings: async () => {},
    replaceRecordExtractionIssues: async () => {},
    clearConditionRecords: async () => {},
    insertConditionRecord: async (payload: Record<string, unknown>) => {
      state.conditionRecords.push(payload);
    },
    recomputeConditionCurrentStatus: async () => {},
    insertFinding: async (payload: Record<string, unknown>) => {
      state.insertedFindings.push(payload);
    },
  } as unknown as HealthStructureRepository;
  return { repository, state };
}

const b12 = {
  obs_code: null,
  obs_name_text: "Витамин В12",
  value: "704",
  value_numeric: 704,
  unit_text: "пг/мл",
  ref_range: "197-771",
  ref_range_low: 197,
  ref_range_high: 771,
  status: "normal",
  source_anchor: "Витамин В12 704 пг/мл",
  confidence: 0.95,
};

const kidneyAbsence = {
  finding_code: null,
  finding_type_text: "Конкременты",
  site_code: null,
  body_site_text: "почках",
  source_anchor: "в почках конкременты не выявлены",
  confidence: 0.9,
};

const canReadRecord = async () => true;

function request(body: unknown, token: string | null = "user-jwt"): Request {
  return new Request("http://localhost/functions/v1/health-ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    record_id: "record-1",
    source_text: DOCUMENT,
    classification: {
      record_type: "lab",
      title: "Витамины",
      record_date: "2025-10-27",
      summary: "",
      keywords: [],
    },
    extraction: { observations: [b12], findings: [], conditions: [], asserted_absences: [] },
    ...overrides,
  };
}

Deno.test(
  "health-ingest stores a value in canonical units and keeps the client's text",
  async () => {
    const { repository, state } = repositoryMock();
    const response = await createHealthIngestHandler({ repository, canReadRecord })(
      request(submission()),
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.rejected, []);
    assertEquals(state.observationRows.length, 1);
    assertEquals(state.observationRows[0].obs_code, "vitamin_b12");
    assertEquals(state.observationRows[0].unit_canonical, "pmol/L");
    assertEquals(Number((state.observationRows[0].value_canonical as number).toFixed(3)), 519.552);
    assertEquals(state.observationRows[0].is_applied, true);
    const recordWrite = state.updates.find((patch) => patch.status === "structure_review");
    assertEquals(recordWrite?.ocr_text, DOCUMENT);
    assertEquals(recordWrite?.ocr_error, null);
    assertEquals(recordWrite?.record_date, "2025-10-27");
  },
);

Deno.test("health-ingest refuses an entity whose anchor is not in the text", async () => {
  const { repository, state } = repositoryMock();
  const ungrounded = { ...b12, source_anchor: "Витамин В12 704 пмоль/л" };
  const response = await createHealthIngestHandler({ repository, canReadRecord })(
    request(
      submission({
        extraction: {
          observations: [ungrounded],
          findings: [],
          conditions: [],
          asserted_absences: [],
        },
      }),
    ),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(state.observationRows, []);
  assertEquals(body.rejected, [
    { entityKind: "observation", reason: "source anchor not found in document text" },
  ]);
});

Deno.test(
  "health-ingest closes a finding only when an absence for a containing site backs it",
  async () => {
    const { repository, state } = repositoryMock();
    const closure = {
      finding_code: "CALCULUS",
      finding_type_text: "Конкременты",
      site_code: "kidney_right",
      body_site_text: "правая почка",
      reason: "не выявлены",
      source_anchor: "в почках конкременты не выявлены",
      confidence: 0.9,
    };
    const backed = await createHealthIngestHandler({ repository, canReadRecord })(
      request(
        submission({
          extraction: {
            observations: [],
            findings: [],
            conditions: [],
            asserted_absences: [kidneyAbsence],
          },
          reconciliation: { findings_to_resolve: [closure] },
        }),
      ),
    );
    assertEquals((await backed.json()).rejected, []);
    assertEquals(state.insertedFindings.length, 1);
    assertEquals(state.insertedFindings[0].resolution_status, "resolved");

    const unbacked = repositoryMock();
    const response = await createHealthIngestHandler({
      repository: unbacked.repository,
      canReadRecord,
    })(request(submission({ reconciliation: { findings_to_resolve: [closure] } })));
    assertEquals((await response.json()).rejected, [
      {
        entityKind: "finding_to_resolve",
        reason: "no asserted absence in this document covers the finding",
      },
    ]);
    assertEquals(unbacked.state.insertedFindings, []);
  },
);

Deno.test(
  "health-ingest proposes a lab closure as pending and refuses an unknown condition",
  async () => {
    const { repository, state } = repositoryMock();
    const response = await createHealthIngestHandler({ repository, canReadRecord })(
      request(
        submission({
          reconciliation: {
            conditions_to_resolve: [
              {
                condition_id: "cond-b12",
                supporting_obs_code: "vitamin_b12",
                reason: "B12 в норме",
                source_anchor: "Витамин В12 704 пг/мл",
                confidence: 0.9,
              },
              {
                condition_id: "cond-someone-else",
                supporting_obs_code: "vitamin_b12",
                reason: "",
                source_anchor: "",
                confidence: 0.5,
              },
            ],
          },
        }),
      ),
    );
    const body = await response.json();

    assertEquals(body.rejected, [
      { entityKind: "condition_to_resolve", reason: "unknown condition id" },
    ]);
    const closure = state.conditionRecords.find((row) => row.condition_id === "cond-b12");
    assertEquals(closure?.review_decision, "pending");
    assertEquals(closure?.is_user_verified, false);
  },
);

Deno.test("health-ingest refuses a call with no text before touching the record", async () => {
  const { repository, state } = repositoryMock();
  const response = await createHealthIngestHandler({ repository, canReadRecord })(
    request(submission({ source_text: "  " })),
  );

  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "Missing required field: source_text");
  assertEquals(state.updates, []);
});

Deno.test("health-ingest refuses a caller that is not an allowed user", async () => {
  const { repository, state } = repositoryMock({ user: null });
  const response = await createHealthIngestHandler({ repository, canReadRecord })(
    request(submission()),
  );

  assertEquals(response.status, 400);
  assertEquals(state.observationRows, []);
});

Deno.test("health-ingest refuses a record the caller's own token cannot read", async () => {
  const { repository, state } = repositoryMock();
  const response = await createHealthIngestHandler({
    repository,
    canReadRecord: async () => false,
  })(request(submission()));

  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "Record not found or access denied");
  assertEquals(state.updates, []);
});

Deno.test("health-ingest refuses a submission missing its extraction", async () => {
  const { repository, state } = repositoryMock();
  const response = await createHealthIngestHandler({ repository, canReadRecord })(
    request(submission({ extraction: undefined })),
  );

  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "Missing required field: extraction");
  assertEquals(state.updates, []);
  assertEquals(state.observationRows, []);
});

Deno.test("health-ingest resolves a finding's codes from its label, not the caller's", async () => {
  const { repository, state } = repositoryMock();
  const findingRows: Record<string, unknown>[] = [];
  (repository as unknown as { replaceRecordFindings: unknown }).replaceRecordFindings = async (
    _id: string,
    rows: Record<string, unknown>[],
  ) => {
    findingRows.push(...rows);
  };
  await createHealthIngestHandler({ repository, canReadRecord })(
    request(
      submission({
        extraction: {
          observations: [],
          findings: [
            {
              finding_code: "SOMETHING_ELSE",
              finding_type_text: "Конкременты",
              site_code: "kidney_right",
              body_site_text: "почках",
              source_anchor: "в почках конкременты",
              confidence: 0.9,
            },
          ],
          conditions: [],
          asserted_absences: [],
        },
      }),
    ),
  );

  assertEquals(state.updates.length > 0, true);
  assertEquals(findingRows[0]?.finding_code, "CALCULUS");
  assertEquals(findingRows[0]?.site_code, "kidney");
});
