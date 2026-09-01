// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import { runHealthStructureService } from "./service.ts";
import type { HealthStructureRepository } from "./repository.ts";
import { emptyLlmUsage, type LlmUsage } from "../_shared/llm-usage.ts";
import type { StructuredDataWithEntities, StructuredParseOutcome } from "./types.ts";

/** The parse dependency now reports what the call cost alongside the entities it produced. */
function parsed(
  structured: StructuredDataWithEntities,
  usage: LlmUsage = emptyLlmUsage(),
  stagesRun: string[] = [],
): StructuredParseOutcome {
  return { structured, usage, stagesRun };
}

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
    claimTaken?: boolean;
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
    renewClaim: async () => true,
    replaceRecordExtractionIssues: async () => {},
    getAttachments: async () => [],
    downloadAttachment: async () => null,
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
    claimRecord: async () => (options.claimTaken === false ? null : "run-1"),
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
    findConditionByIcd: async () => null,
    findConditionByName: async () => null,
    createCondition: async () => ({ id: "cond-created" }),
    updateCondition: async () => {},
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
  spans: Array<{ name: string; endAttrs?: Record<string, unknown> }>;
} {
  const infos: Array<{ message: string; attrs?: Record<string, unknown> }> = [];
  const warns: Array<{ message: string; attrs?: Record<string, unknown> }> = [];
  const spans: Array<{ name: string; endAttrs?: Record<string, unknown> }> = [];

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
    startSpan: (name) => {
      const span: { name: string; endAttrs?: Record<string, unknown> } = { name };
      spans.push(span);
      return {
        traceId: "trace-1",
        spanId: "span-1",
        requestId: "request-1",
        traceparent: "00-trace-1-span-1-01",
        log: () => {},
        end: async (options) => {
          span.endAttrs = options?.attrs;
        },
      };
    },
  };

  return { telemetry, infos, warns, spans };
}

Deno.test("runHealthStructureService returns auth/guard errors", async () => {
  const noUser = createRepositoryMock({ user: null });
  const unauthorized = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: noUser.repository,
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
    },
  );
  assertEquals(unauthorized.status, 400);
  assertEquals(unauthorized.payload.success, false);

  const missingRecord = createRepositoryMock();
  const missingRecordResult = await runHealthStructureService(
    { authToken: "token", recordId: null },
    {
      repository: missingRecord.repository,
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
    },
  );
  assertEquals(missingRecordResult.payload.error, "Missing required field: record_id");

  const noTokenResult = await runHealthStructureService(
    { authToken: null, recordId: "record-1" },
    {
      repository: missingRecord.repository,
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
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
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
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
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
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
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
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
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async (code) => ({
        code,
        found: true,
        name_en: "EN",
        name_ru: "RU",
      }),
    },
  );

  assertEquals(result.status, 200);
  assertEquals(result.payload.success, true);
  // The status write, then the claim release once every related row is persisted.
  assertEquals(state.updatedRecords.length, 2);
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
        parseStructuredData: async () =>
          parsed({
            ...structuredData,
            checkups_to_complete: [],
            findings: [{ ...structuredData.findings[0], source_anchor: "   " }],
            conditions: [],
            findings_to_resolve: [],
            conditions_to_resolve: [],
          }),
        lookupIcdCode: async () => null,
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
      lookupIcdCode: async () => null,
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
      parseStructuredData: async () =>
        parsed({
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
      lookupIcdCode: async () => null,
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
  // A zero the document really printed survives: it is no longer coerced to 1 to keep it out of
  // the resolved sentinel's way.
  assertEquals(state.findingRows[0].count, 0);
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
      lookupIcdCode: async () => null,
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
        parseStructuredData: async () =>
          parsed({
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
        lookupIcdCode: async () => null,
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

Deno.test("runHealthStructureService puts the parse cost on the record's own span", async () => {
  const { repository } = createRepositoryMock();
  const { telemetry, spans } = createTelemetryMock();

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      telemetry,
      parseStructuredData: async () =>
        parsed(structuredData, { promptTokens: 1200, completionTokens: 340, costUsd: 0.0042 }, [
          "classify",
          "extract",
        ]),
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(result.status, 200);
  const parseSpan = spans.find((span) => span.name === "edge.health_structure.parse_llm");
  assertEquals(parseSpan?.endAttrs?.llm_prompt_tokens, 1200);
  assertEquals(parseSpan?.endAttrs?.llm_completion_tokens, 340);
  assertEquals(parseSpan?.endAttrs?.llm_cost_usd, 0.0042);
  assertEquals(parseSpan?.endAttrs?.stages_run, "classify,extract");
});

Deno.test(
  "runHealthStructureService omits cost attributes the provider did not report",
  async () => {
    const { repository } = createRepositoryMock();
    const { telemetry, spans } = createTelemetryMock();

    await runHealthStructureService(
      { authToken: "token", recordId: "record-1" },
      {
        repository,
        telemetry,
        parseStructuredData: async () => parsed(structuredData),
        lookupIcdCode: async () => null,
      },
    );

    const parseSpan = spans.find((span) => span.name === "edge.health_structure.parse_llm");
    // Unknown, never zero: a zero here would read as a free call on any dashboard that averages it.
    assertEquals("llm_prompt_tokens" in (parseSpan?.endAttrs ?? {}), false);
    assertEquals("llm_cost_usd" in (parseSpan?.endAttrs ?? {}), false);
  },
);

Deno.test("runHealthStructureService leaves a durable structure_error on failure", async () => {
  const { repository, state } = createRepositoryMock();

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      parseStructuredData: async () => {
        throw new Error("OpenRouter timeout");
      },
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(result.status, 400);
  const errorWrite = state.updatedRecords.find((update) => "structure_error" in update.patch);
  assertEquals(errorWrite?.recordId, "record-1");
  assertEquals(errorWrite?.patch.structure_error, "OpenRouter timeout");
});

Deno.test("runHealthStructureService clears structure_error when the run succeeds", async () => {
  const { repository, state } = createRepositoryMock();

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(result.status, 200);
  const recordWrite = state.updatedRecords.find((update) => "structure_error" in update.patch);
  assertEquals(recordWrite?.patch.structure_error, null);
  assertEquals(recordWrite?.patch.status, "structure_review");
});

Deno.test(
  "runHealthStructureService keeps the original error when the failure write fails",
  async () => {
    const { repository } = createRepositoryMock();

    const result = await runHealthStructureService(
      { authToken: "token", recordId: "record-1" },
      {
        repository: {
          ...repository,
          updateMedicalRecord: async () => {
            throw new Error("database unreachable");
          },
        },
        parseStructuredData: async () => {
          throw new Error("OpenRouter timeout");
        },
        lookupIcdCode: async () => null,
        log: { log: () => {}, warn: () => {}, error: () => {} },
      },
    );

    assertEquals(result.status, 400);
    assertEquals(result.payload.error, "OpenRouter timeout");
  },
);

Deno.test(
  "runHealthStructureService does not stamp a record for an unauthenticated caller",
  async () => {
    const { repository, state } = createRepositoryMock({ user: null });

    // health-structure runs with verify_jwt = false and writes with the service-role client, so a
    // caller who merely knows a record id must not be able to reach the failure write.
    const result = await runHealthStructureService(
      { authToken: "not-a-token", recordId: "record-1" },
      {
        repository,
        parseStructuredData: async () => parsed(structuredData),
        lookupIcdCode: async () => null,
      },
    );

    assertEquals(result.status, 400);
    assertEquals(
      state.updatedRecords.some((update) => "structure_error" in update.patch),
      false,
    );
  },
);

Deno.test("runHealthStructureService does not stamp a record it could not find", async () => {
  const { repository, state } = createRepositoryMock({ record: null });

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(result.status, 400);
  assertEquals(
    state.updatedRecords.some((update) => "structure_error" in update.patch),
    false,
  );
});

Deno.test("runHealthStructureService refuses a record another run already owns", async () => {
  const { repository, state } = createRepositoryMock({ claimTaken: false });

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(result.status, 409);
  // Nothing is written: the run that owns the record decides its status, and a structure_error
  // here would report that run's progress as this caller's failure.
  assertEquals(state.updatedRecords.length, 0);
});

Deno.test("runHealthStructureService writes its result under the claim it took", async () => {
  const { repository, state } = createRepositoryMock();
  const runIds: Array<string | undefined> = [];

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: {
        ...repository,
        updateMedicalRecord: async (recordId, patch, options) => {
          runIds.push(options?.runId);
          await repository.updateMedicalRecord(recordId, patch, options);
        },
      },
      parseStructuredData: async () => parsed(structuredData),
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(result.status, 200);
  assertEquals(runIds, ["run-1", "run-1"]);
  // The status write does not release the record: observations, findings and resolutions are
  // still to come, and a second run must not start on top of them.
  assertEquals("processing_run_id" in state.updatedRecords[0].patch, false);
  // The release is its own write, after all of it.
  const release = state.updatedRecords[1].patch;
  assertEquals(release.processing_run_id, null);
  assertEquals(release.processing_started_at, null);
});

Deno.test(
  "runHealthStructureService does not stamp a record whose claim it never took",
  async () => {
    const { repository, state } = createRepositoryMock();

    const result = await runHealthStructureService(
      { authToken: "token", recordId: "record-1" },
      {
        repository: {
          ...repository,
          // A transient failure while another worker owns the record.
          claimRecord: async () => {
            throw new Error("claim rpc unavailable");
          },
        },
        parseStructuredData: async () => parsed(structuredData),
        lookupIcdCode: async () => null,
        log: { log: () => {}, warn: () => {}, error: () => {} },
      },
    );

    assertEquals(result.status, 400);
    // An unguarded write here would clear the owning run's claim and stamp its record.
    assertEquals(state.updatedRecords.length, 0);
  },
);

Deno.test("runHealthStructureService hands a failed record back to review", async () => {
  const { repository, state } = createRepositoryMock();

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      parseStructuredData: async () => {
        throw new Error("OpenRouter timeout");
      },
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(result.status, 400);
  const patch = state.updatedRecords[0].patch;
  // Leaving `structuring` behind would show the record as worked on by a run that is gone; the
  // client-side rollback only happens when a browser is still there to do it.
  assertEquals(patch.status, "ocr_review");
  assertEquals(patch.structure_error, "OpenRouter timeout");
  assertEquals(patch.processing_run_id, null);
});

// The pages are context: a record whose attachments cannot be read still structures from its
// text, exactly as it did before they were sent at all.
Deno.test("runHealthStructureService hands the record's pages to the parser", async () => {
  const { repository } = createRepositoryMock();
  let seenPages: string[] | undefined;

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository,
      loadPageImages: async () => ["data:image/jpeg;base64,AAAA"],
      parseStructuredData: async (_ocrText, context) => {
        seenPages = context.pageImages;
        return parsed(structuredData);
      },
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(result.status, 200);
  assertEquals(seenPages, ["data:image/jpeg;base64,AAAA"]);
});

Deno.test(
  "runHealthStructureService structures from text alone when there are no pages",
  async () => {
    const { repository } = createRepositoryMock();
    let seenPages: string[] | undefined;

    const result = await runHealthStructureService(
      { authToken: "token", recordId: "record-1" },
      {
        repository,
        parseStructuredData: async (_ocrText, context) => {
          seenPages = context.pageImages;
          return parsed(structuredData);
        },
        lookupIcdCode: async () => null,
      },
    );

    assertEquals(result.status, 200);
    assertEquals(seenPages, []);
  },
);

// The renewal has to name the run that holds the claim; one that named anything else would
// renew nothing and the record would be reaped out from under a live parse.
Deno.test("runHealthStructureService renews under the claim it took", async () => {
  const { repository } = createRepositoryMock();
  const renewals: Array<{ recordId: string; runId: string }> = [];

  const result = await runHealthStructureService(
    { authToken: "token", recordId: "record-1" },
    {
      repository: {
        ...repository,
        renewClaim: async (recordId, runId) => {
          renewals.push({ recordId, runId });
          return true;
        },
      },
      parseStructuredData: async (_ocrText, context) => {
        // Whatever the parser does with it, it must reach the record's own claim.
        assertEquals(await context.renewClaim?.(), true);
        return parsed(structuredData);
      },
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(result.status, 200);
  assertEquals(renewals, [{ recordId: "record-1", runId: "run-1" }]);
});

// The corrections are the record's data, not telemetry: they have to survive the request that
// made them, and a re-run must not stack yesterday's on top of today's.
Deno.test(
  "runHealthStructureService writes the extraction's corrections to the record",
  async () => {
    const { repository } = createRepositoryMock();
    const written: Array<{ recordId: string; rows: Record<string, unknown>[] }> = [];

    const result = await runHealthStructureService(
      { authToken: "token", recordId: "record-1" },
      {
        repository: {
          ...repository,
          replaceRecordExtractionIssues: async (recordId, rows) => {
            written.push({ recordId, rows });
          },
        },
        parseStructuredData: async () => ({
          ...parsed(structuredData),
          issues: [
            {
              entityKind: "observation",
              field: "observation.status",
              received: "borderline",
              resolution: "replaced_with_default" as const,
              appliedFallback: "unknown",
              detail: null,
            },
          ],
        }),
        lookupIcdCode: async () => null,
      },
    );

    assertEquals(result.status, 200);
    assertEquals(written.length, 1);
    assertEquals(written[0].recordId, "record-1");
    assertEquals(written[0].rows, [
      {
        record_id: "record-1",
        entity_kind: "observation",
        field: "observation.status",
        received: "borderline",
        resolution: "replaced_with_default",
        applied_fallback: "unknown",
        detail: null,
      },
    ]);
  },
);

Deno.test(
  "a parse with nothing to correct still clears the record's previous corrections",
  async () => {
    const { repository } = createRepositoryMock();
    const written: Array<Record<string, unknown>[]> = [];

    await runHealthStructureService(
      { authToken: "token", recordId: "record-1" },
      {
        repository: {
          ...repository,
          replaceRecordExtractionIssues: async (_recordId, rows) => {
            written.push(rows);
          },
        },
        parseStructuredData: async () => parsed(structuredData),
        lookupIcdCode: async () => null,
      },
    );

    // Called with nothing rather than not called: a retry that succeeds cleanly must leave no
    // warning behind from the run before it.
    assertEquals(written, [[]]);
  },
);
