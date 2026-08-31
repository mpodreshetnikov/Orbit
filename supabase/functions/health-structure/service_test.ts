// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import { runHealthStructureService } from "./service.ts";
import type { HealthStructureRepository } from "./repository.ts";
import type { StructuredDataWithEntities } from "./types.ts";

interface ServiceState {
  updatedRecords: Array<{ recordId: string; patch: Record<string, unknown> }>;
  observationRows: Record<string, unknown>[];
  findingRows: Record<string, unknown>[];
  conditionRecords: Record<string, unknown>[];
  insertedFindings: Record<string, unknown>[];
}

function createRepositoryMock(
  options: {
    user?: { id: string; email: string | null } | null;
    record?: Record<string, unknown> | null;
    observationCatalog?: Awaited<ReturnType<HealthStructureRepository["fetchObservationCatalog"]>>;
    existingConditions?: Awaited<ReturnType<HealthStructureRepository["fetchPersonConditions"]>>;
    existingFindings?: Awaited<ReturnType<HealthStructureRepository["fetchPersonActiveFindings"]>>;
  } = {},
): { repository: HealthStructureRepository; state: ServiceState } {
  const state: ServiceState = {
    updatedRecords: [],
    observationRows: [],
    findingRows: [],
    conditionRecords: [],
    insertedFindings: [],
  };

  const repository: HealthStructureRepository = {
    authenticateAllowedUser: async () =>
      options.user !== undefined ? options.user : { id: "user-1", email: "user@example.com" },
    getRecord: async () =>
      options.record !== undefined
        ? options.record
        : {
            id: "record-1",
            person_id: "person-1",
            ocr_text: "ocr content",
            status: "ocr_review",
          },
    fetchObservationCatalog: async () =>
      options.observationCatalog ?? [
        {
          id: "obs-1",
          obs_code: "GLU",
          name_ru: "Глюкоза",
          name_en: "Glucose",
          canonical_unit: "mmol/L",
          synonyms_ru: [],
          synonyms_en: [],
          accepted_units: {
            "mg/dL": { factor_to_canonical: 0.0555 },
          },
        },
      ],
    fetchFindingTypeCatalog: async () => [
      {
        id: "ft-1",
        finding_code: "F1",
        name_ru: "Узел",
        name_en: "Nodule",
        synonyms_ru: [],
        synonyms_en: [],
      },
    ],
    fetchBodySiteCatalog: async () => [
      {
        id: "bs-1",
        site_code: "LUNG",
        name_ru: "Легкое",
        name_en: "Lung",
        parent_site_code: null,
        synonyms_ru: [],
        synonyms_en: [],
      },
    ],
    fetchPersonConditions: async () =>
      options.existingConditions ?? [
        {
          id: "cond-existing",
          name: "Condition",
          code: "A00",
          current_status: "active",
          onset_date: null,
          resolved_date: null,
        },
      ],
    fetchPersonActiveFindings: async () =>
      options.existingFindings ?? [
        {
          finding_code: "F1",
          finding_type_text: "Nodule",
          site_code: "LUNG",
          body_site_text: "Lung",
          finding_type_id: "ft-1",
          body_site_id: "bs-1",
        },
      ],
    fetchUpcomingOverdueCheckupItems: async () => [
      {
        id: "checkup-1",
        title: "Annual blood test",
        category: "lab",
        next_due_at: "2026-02-01",
      },
    ],
    updateMedicalRecord: async (recordId, patch) => {
      state.updatedRecords.push({ recordId, patch });
    },
    replaceRecordObservations: async (_recordId, rows) => {
      state.observationRows = rows;
    },
    replaceRecordFindings: async (_recordId, rows) => {
      state.findingRows = rows;
    },
    clearConditionRecords: async () => {},
    insertConditionRecord: async (payload) => {
      state.conditionRecords.push(payload);
    },
    recomputeConditionCurrentStatus: async () => {},
    insertFinding: async (payload) => {
      state.insertedFindings.push(payload);
    },
  };

  return { repository, state };
}

const structuredData: StructuredDataWithEntities = {
  record_type: "lab",
  title: "Blood panel",
  record_date: "2026-01-01",
  summary: "summary",
  keywords: ["blood"],
  observations: [
    {
      obs_code: "GLU",
      obs_name: "Glucose",
      value: "100",
      value_numeric: 100,
      unit: "mg/dL",
      ref_range: "70-99",
      ref_range_low: 70,
      ref_range_high: 99,
      status: "high",
      confidence: 0.9,
    },
  ],
  findings: [
    {
      finding_code: "F1",
      finding_type_text: "Nodule",
      site_code: "LUNG",
      body_site_text: "Lung",
      size_mm: 2,
      count: 1,
      severity: "mild",
      laterality: "left",
      morphology: null,
      description: null,
      histology: null,
      finding_date: null,
      source_anchor: "line",
      confidence: 0.8,
    },
  ],
  conditions: [
    {
      existing_condition_id: null,
      name: "Diabetes",
      icd_code: "E11.9",
      status: "suspected",
      confidence: 0.7,
      source_anchor: "line",
    },
  ],
  findings_to_resolve: [
    {
      finding_code: "F1",
      finding_type_text: "Nodule",
      site_code: "LUNG",
      body_site_text: null,
      reason: "resolved",
      source_anchor: "line",
      confidence: 0.8,
    },
  ],
  conditions_to_resolve: [
    {
      condition_id: "cond-existing",
      reason: "resolved",
      source_anchor: "line",
      confidence: 0.7,
    },
  ],
  checkups_to_complete: [
    {
      checkup_item_id: "checkup-1",
      reason: "done",
      suggested_done_at: "2026-01-02",
    },
  ],
};

function createTelemetryMock(): {
  telemetry: EdgeTelemetry;
  infos: Array<{ message: string; attrs?: Record<string, unknown> }>;
  warns: Array<{ message: string; attrs?: Record<string, unknown> }>;
} {
  const infos: Array<{ message: string; attrs?: Record<string, unknown> }> = [];
  const warns: Array<{ message: string; attrs?: Record<string, unknown> }> = [];

  const telemetry: EdgeTelemetry = {
    context: {
      component: "health-structure-test",
      traceId: "trace-1",
      requestId: "request-1",
      env: "test",
      release: "test",
    },
    debug: () => {},
    info: (message, attrs) => {
      infos.push({ message, attrs });
    },
    warn: (message, attrs) => {
      warns.push({ message, attrs });
    },
    error: () => {},
    startSpan: () => ({
      traceId: "trace-1",
      spanId: "span-1",
      requestId: "request-1",
      traceparent: "00-trace-1-span-1-01",
      log: () => {},
      end: async () => {},
    }),
  };

  return { telemetry, infos, warns };
}

Deno.test("runHealthStructureService returns auth/guard errors", async () => {
  const noUser = createRepositoryMock({ user: null });
  const unauthorized = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: noUser.repository,
      parseStructuredData: async () => structuredData,
    },
  );
  assertEquals(unauthorized.status, 400);
  assertEquals(unauthorized.payload.success, false);

  const missingRecord = createRepositoryMock();
  const missingRecordResult = await runHealthStructureService(
    { authToken: "token", recordId: null },
    {
      repository: missingRecord.repository,
      parseStructuredData: async () => structuredData,
    },
  );
  assertEquals(missingRecordResult.payload.error, "Missing required field: record_id");

  const noTokenResult = await runHealthStructureService(
    { authToken: null, recordId: "record-1" },
    {
      repository: missingRecord.repository,
      parseStructuredData: async () => structuredData,
    },
  );
  assertEquals(noTokenResult.payload.error, "Missing authorization header");
});

Deno.test("runHealthStructureService handles missing record and missing OCR text", async () => {
  const noRecord = createRepositoryMock({ record: null });
  const noRecordResult = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: noRecord.repository,
      parseStructuredData: async () => structuredData,
    },
  );
  assertEquals(noRecordResult.payload.error, "Record not found or access denied");

  const noOcr = createRepositoryMock({
    record: {
      id: "record-1",
      person_id: "person-1",
      ocr_text: null,
      status: "ocr_review",
    },
  });
  const noOcrResult = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: noOcr.repository,
      parseStructuredData: async () => structuredData,
    },
  );
  assertEquals(
    noOcrResult.payload.error,
    "No OCR text found for this record. Run health-ocr first.",
  );

  const missingPerson = createRepositoryMock({
    record: {
      id: "record-1",
      person_id: null,
      ocr_text: "ocr",
      status: "ocr_review",
    },
  });
  const missingPersonResult = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: missingPerson.repository,
      parseStructuredData: async () => structuredData,
    },
  );
  assertEquals(missingPersonResult.payload.error, "Record is missing person_id");
});

Deno.test("runHealthStructureService persists successful extraction flow", async () => {
  const { repository, state } = createRepositoryMock();
  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      parseStructuredData: async () => structuredData,
    },
  );

  assertEquals(result.status, 200);
  assertEquals(result.payload.success, true);
  assertEquals(state.updatedRecords.length, 1);
  assertEquals(state.observationRows.length, 1);
  assertEquals(state.findingRows.length, 1);
  assertEquals(state.conditionRecords.length, 2);
  assertEquals(state.insertedFindings.length, 1);
});

Deno.test(
  "runHealthStructureService filters empty finding anchors and empty checkup suggestions",
  async () => {
    const { repository, state } = createRepositoryMock();
    const result = await runHealthStructureService(
      { authToken: "token", recordId: "record-1" },
      {
        repository: {
          ...repository,
          fetchUpcomingOverdueCheckupItems: async () => [],
        },
        parseStructuredData: async () => ({
          ...structuredData,
          checkups_to_complete: [],
          findings: [{ ...structuredData.findings[0], source_anchor: "   " }],
          conditions: [],
          findings_to_resolve: [],
          conditions_to_resolve: [],
        }),
      },
    );

    assertEquals(result.status, 200);
    assertEquals(state.findingRows.length, 0);
  },
);

Deno.test("runHealthStructureService returns error when parser fails", async () => {
  const { repository } = createRepositoryMock();
  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      parseStructuredData: async () => {
        throw new Error("OpenRouter timeout");
      },
    },
  );

  assertEquals(result.status, 400);
  assertEquals(result.payload.error, "OpenRouter timeout");
});

Deno.test("runHealthStructureService applies catalog/checkup fallback mappings", async () => {
  const { repository, state } = createRepositoryMock({
    observationCatalog: [],
  });

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      parseStructuredData: async () => ({
        ...structuredData,
        record_date: "2026-01-05",
        observations: [
          {
            ...structuredData.observations[0],
            obs_code: "UNKNOWN",
          },
        ],
        findings: [
          {
            ...structuredData.findings[0],
            finding_code: "UNKNOWN",
            site_code: "UNKNOWN",
            count: 0,
            finding_date: "",
          },
        ],
        checkups_to_complete: [
          {
            checkup_item_id: "checkup-missing",
            reason: "",
            suggested_done_at: "2026-01-06",
          },
        ],
      }),
    },
  );

  assertEquals(result.status, 200);
  // The observation catalogue is empty here, so nothing can resolve it.
  assertEquals(state.observationRows[0].catalog_id, null);
  assertEquals(state.observationRows[0].is_applied, false);
  assertEquals(state.observationRows[0].obs_code, null);
  // The finding and body site carry a bogus code but a real printed label, so label-based
  // resolution rescues them. Previously the bogus code left both unmapped.
  assertEquals(state.findingRows[0].finding_type_id, "ft-1");
  assertEquals(state.findingRows[0].body_site_id, "bs-1");
  // The stored code is the resolved one, never the model's guess.
  assertEquals(state.findingRows[0].finding_code, "F1");
  assertEquals(state.findingRows[0].site_code, "LUNG");
  assertEquals(state.findingRows[0].count, 1);
  assertEquals(state.findingRows[0].finding_date, "2026-01-05");

  const updatedPatch = state.updatedRecords[0]?.patch as
    | { llm_suggested_checkup_completions?: Array<{ checkup_title?: string }> }
    | undefined;
  assertEquals(updatedPatch?.llm_suggested_checkup_completions?.[0]?.checkup_title, "Checkup");
});

Deno.test("runHealthStructureService handles non-Error parse failures", async () => {
  const { repository } = createRepositoryMock();
  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      parseStructuredData: async () => {
        throw "parser failed";
      },
    },
  );

  assertEquals(result.status, 400);
  assertEquals(result.payload.error, "Unknown error");
});

Deno.test(
  "runHealthStructureService emits telemetry for dropped and unresolved entities",
  async () => {
    const { repository } = createRepositoryMock({
      observationCatalog: [],
    });
    const { telemetry, infos, warns } = createTelemetryMock();

    const result = await runHealthStructureService(
      { authToken: "token", recordId: "record-1" },
      {
        repository,
        telemetry,
        parseStructuredData: async () => ({
          ...structuredData,
          observations: [
            { ...structuredData.observations[0], obs_code: "UNKNOWN" },
            { ...structuredData.observations[0], obs_code: null, obs_name: "   " },
          ],
          findings: [
            {
              ...structuredData.findings[0],
              finding_code: "UNKNOWN",
              finding_type_text: "Entirely absent from the catalogue",
              site_code: "UNKNOWN",
              body_site_text: "Also absent",
            },
            {
              ...structuredData.findings[0],
              finding_code: null,
              site_code: null,
              finding_type_text: "   ",
              source_anchor: "line",
            },
          ],
        }),
      },
    );

    assertEquals(result.status, 200);
    assertEquals(
      infos.some(
        (entry) => entry.message === "health_structure_unresolved_observation_catalog_refs",
      ),
      true,
    );
    assertEquals(
      infos.some((entry) => entry.message === "health_structure_unresolved_finding_catalog_refs"),
      true,
    );
    assertEquals(
      warns.some((entry) => entry.message === "health_structure_invalid_observations_dropped"),
      true,
    );
    assertEquals(
      warns.some((entry) => entry.message === "health_structure_invalid_findings_dropped"),
      true,
    );
  },
);
