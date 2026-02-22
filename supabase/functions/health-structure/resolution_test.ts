// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import {
  processConditionsToResolve,
  processExtractedConditions,
  processFindingsToResolve,
  resolveOrCreateCondition,
} from "./resolution.ts";
import type { ResolutionRepository } from "./resolution.ts";
import type { ExistingCondition, ExistingFinding, ExtractedCondition } from "./types.ts";

interface ResolutionState {
  createdConditions: Record<string, unknown>[];
  updatedConditions: Array<{ id: string; patch: Record<string, unknown> }>;
  conditionRecords: Record<string, unknown>[];
  recomputedIds: string[];
  insertedFindings: Record<string, unknown>[];
}

function createResolutionRepository(
  options: {
    byIcd?: { id: string } | null;
    byName?: { id: string } | null;
    createdConditionId?: string | null;
    throwOnInsertFinding?: boolean;
    throwOnInsertConditionRecord?: boolean;
  } = {},
): { repository: ResolutionRepository; state: ResolutionState } {
  const state: ResolutionState = {
    createdConditions: [],
    updatedConditions: [],
    conditionRecords: [],
    recomputedIds: [],
    insertedFindings: [],
  };

  const repository: ResolutionRepository = {
    findConditionByIcd: async () => options.byIcd ?? null,
    findConditionByName: async () => options.byName ?? null,
    createCondition: async (payload) => {
      state.createdConditions.push(payload);
      if (options.createdConditionId === null) return null;
      return { id: options.createdConditionId ?? "created-1" };
    },
    updateCondition: async (id, patch) => {
      state.updatedConditions.push({ id, patch });
    },
    insertConditionRecord: async (payload) => {
      if (options.throwOnInsertConditionRecord) throw new Error("condition record failed");
      state.conditionRecords.push(payload);
    },
    recomputeConditionCurrentStatus: async (id) => {
      state.recomputedIds.push(id);
    },
    insertFinding: async (payload) => {
      if (options.throwOnInsertFinding) throw new Error("finding insert failed");
      state.insertedFindings.push(payload);
    },
  };

  return { repository, state };
}

const lookupFound = async (code: string) => ({
  code,
  name_en: "Name EN",
  name_ru: "Name RU",
  found: true,
});

Deno.test(
  "resolveOrCreateCondition updates existing condition when ICD lookup succeeds",
  async () => {
    const { repository, state } = createResolutionRepository();
    const conditionId = await resolveOrCreateCondition(
      {
        existing_condition_id: "cond-1",
        name: "Diabetes",
        icd_code: "E11.9",
        status: "active",
        confidence: 0.9,
        source_anchor: "anchor",
      },
      "person-1",
      {
        repository,
        lookupIcdCode: lookupFound,
      },
    );

    assertEquals(conditionId, "cond-1");
    assertEquals(state.updatedConditions.length, 1);
    assertEquals(state.updatedConditions[0].id, "cond-1");
  },
);

Deno.test("resolveOrCreateCondition matches by ICD code or creates new condition", async () => {
  const foundByCode = createResolutionRepository({ byIcd: { id: "cond-by-code" } });
  const fromExistingCode = await resolveOrCreateCondition(
    {
      existing_condition_id: null,
      name: "Condition",
      icd_code: "A00",
      status: "active",
      confidence: 1,
      source_anchor: null,
    },
    "person-1",
    {
      repository: foundByCode.repository,
      lookupIcdCode: lookupFound,
    },
  );
  assertEquals(fromExistingCode, "cond-by-code");

  const createNew = createResolutionRepository({ byIcd: null, createdConditionId: "cond-created" });
  const created = await resolveOrCreateCondition(
    {
      existing_condition_id: null,
      name: "Condition",
      icd_code: "A01",
      status: "suspected",
      confidence: 1,
      source_anchor: null,
    },
    "person-1",
    {
      repository: createNew.repository,
      lookupIcdCode: lookupFound,
    },
  );
  assertEquals(created, "cond-created");
  assertEquals(createNew.state.createdConditions.length, 1);
});

Deno.test(
  "resolveOrCreateCondition falls back to name matching and can skip nameless condition",
  async () => {
    const byName = createResolutionRepository({ byName: { id: "cond-by-name" } });
    const matched = await resolveOrCreateCondition(
      {
        existing_condition_id: null,
        name: "Hypertension",
        icd_code: null,
        status: "active",
        confidence: 1,
        source_anchor: null,
      },
      "person-1",
      {
        repository: byName.repository,
        lookupIcdCode: async () => null,
      },
    );
    assertEquals(matched, "cond-by-name");

    const none = await resolveOrCreateCondition(
      {
        existing_condition_id: null,
        name: " ",
        icd_code: null,
        status: "active",
        confidence: 1,
        source_anchor: null,
      },
      "person-1",
      {
        repository: byName.repository,
        lookupIcdCode: async () => null,
      },
    );
    assertEquals(none, null);
  },
);

Deno.test(
  "processExtractedConditions inserts records and recomputes status for resolved IDs",
  async () => {
    const { repository, state } = createResolutionRepository({
      createdConditionId: "cond-created",
    });

    const conditions: ExtractedCondition[] = [
      {
        existing_condition_id: "cond-existing",
        name: "Diabetes",
        icd_code: null,
        status: "active",
        confidence: 0.8,
        source_anchor: "line 1",
      },
      {
        existing_condition_id: null,
        name: "Asthma",
        icd_code: null,
        status: "suspected",
        confidence: 0.7,
        source_anchor: "line 2",
      },
      {
        existing_condition_id: null,
        name: " ",
        icd_code: null,
        status: "suspected",
        confidence: 0.4,
        source_anchor: "line 3",
      },
    ];

    await processExtractedConditions("record-1", "person-1", conditions, {
      repository,
      lookupIcdCode: async () => null,
    });

    assertEquals(state.conditionRecords.length, 2);
    assertEquals(state.recomputedIds.length, 2);
  },
);

Deno.test("processExtractedConditions skips records when creation fails", async () => {
  const { repository, state } = createResolutionRepository({
    byName: null,
    createdConditionId: null,
    throwOnInsertConditionRecord: true,
  });

  await processExtractedConditions(
    "record-1",
    "person-1",
    [
      {
        existing_condition_id: null,
        name: "Condition",
        icd_code: null,
        status: "active",
        confidence: 0.5,
        source_anchor: "line",
      },
    ],
    {
      repository,
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(state.conditionRecords.length, 0);
  assertEquals(state.recomputedIds.length, 0);
});

Deno.test("processFindingsToResolve matches by code/site and text fallback", async () => {
  const { repository, state } = createResolutionRepository();
  const existingFindings: ExistingFinding[] = [
    {
      finding_code: "F1",
      finding_type_text: "Nodule",
      site_code: "LUNG",
      body_site_text: "Lung",
      finding_type_id: "ft-1",
      body_site_id: "bs-1",
    },
    {
      finding_code: null,
      finding_type_text: "Cyst",
      site_code: null,
      body_site_text: "Kidney",
      finding_type_id: "ft-2",
      body_site_id: "bs-2",
    },
  ];

  await processFindingsToResolve(
    "record-1",
    "person-1",
    "2026-01-01",
    [
      {
        finding_code: "F1",
        finding_type_text: "nodule",
        site_code: "LUNG",
        body_site_text: null,
        reason: "resolved",
        source_anchor: "line",
        confidence: 0.9,
      },
      {
        finding_code: null,
        finding_type_text: "cyst",
        site_code: null,
        body_site_text: "kidney",
        reason: "resolved",
        source_anchor: "line",
        confidence: 0.8,
      },
      {
        finding_code: "MISSING",
        finding_type_text: "unknown",
        site_code: null,
        body_site_text: null,
        reason: "skip",
        source_anchor: "line",
        confidence: 0.1,
      },
    ],
    existingFindings,
    {
      repository,
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(state.insertedFindings.length, 2);
  assertEquals(state.insertedFindings[0].size_mm, 0);
  assertEquals(state.insertedFindings[1].count, 0);
});

Deno.test("processFindingsToResolve continues when insert fails", async () => {
  const { repository, state } = createResolutionRepository({ throwOnInsertFinding: true });
  await processFindingsToResolve(
    "record-1",
    "person-1",
    "2026-01-01",
    [
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
    [
      {
        finding_code: "F1",
        finding_type_text: "Nodule",
        site_code: "LUNG",
        body_site_text: "Lung",
        finding_type_id: "ft-1",
        body_site_id: "bs-1",
      },
    ],
    {
      repository,
      lookupIcdCode: async () => null,
    },
  );
  assertEquals(state.insertedFindings.length, 0);
});

Deno.test("processConditionsToResolve inserts only known conditions", async () => {
  const { repository, state } = createResolutionRepository();
  const existingConditions: ExistingCondition[] = [
    {
      id: "cond-1",
      name: "Condition",
      code: null,
      current_status: "active",
      onset_date: null,
      resolved_date: null,
    },
  ];

  await processConditionsToResolve(
    "record-1",
    [
      {
        condition_id: "",
        reason: "skip-empty",
        source_anchor: "line",
        confidence: 0.1,
      },
      {
        condition_id: "cond-1",
        reason: "resolved",
        source_anchor: "line",
        confidence: 0.9,
      },
      {
        condition_id: "missing",
        reason: "skip",
        source_anchor: "line",
        confidence: 0.1,
      },
    ],
    existingConditions,
    {
      repository,
      lookupIcdCode: async () => null,
    },
  );

  assertEquals(state.conditionRecords.length, 1);
  assertEquals(state.conditionRecords[0].status_in_record, "resolved");
  assertEquals(state.recomputedIds, ["cond-1"]);
});

Deno.test("resolveOrCreateCondition returns null when ICD-based create fails", async () => {
  const { repository } = createResolutionRepository({
    byIcd: null,
    createdConditionId: null,
  });

  const resolved = await resolveOrCreateCondition(
    {
      existing_condition_id: null,
      name: "Condition",
      icd_code: "A00",
      status: "active",
      confidence: 0.9,
      source_anchor: null,
    },
    "person-1",
    {
      repository,
      lookupIcdCode: lookupFound,
    },
  );

  assertEquals(resolved, null);
});

Deno.test("processExtractedConditions logs insertion failures and non-string names", async () => {
  const { repository, state } = createResolutionRepository({
    throwOnInsertConditionRecord: true,
  });
  const errors: string[] = [];

  await processExtractedConditions(
    "record-1",
    "person-1",
    [
      {
        existing_condition_id: "cond-existing",
        name: "Condition",
        icd_code: null,
        status: "active",
        confidence: 0.8,
        source_anchor: "anchor",
      },
      {
        existing_condition_id: null,
        name: 123 as unknown as string,
        icd_code: null,
        status: "active",
        confidence: 0.1,
        source_anchor: null,
      },
    ],
    {
      repository,
      lookupIcdCode: async () => null,
      log: {
        log: () => {},
        warn: () => {},
        error: (...args: unknown[]) => errors.push(args.map((item) => String(item)).join(" ")),
      },
    },
  );

  assertEquals(state.conditionRecords.length, 0);
  assertEquals(state.recomputedIds.length, 0);
  assertEquals(errors.length > 0, true);
});

Deno.test(
  "processFindingsToResolve handles code-only matching, fallback anchors and warning/error logs",
  async () => {
    const { repository } = createResolutionRepository({ throwOnInsertFinding: true });
    const warnings: string[] = [];
    const errors: string[] = [];

    await processFindingsToResolve(
      "record-1",
      "person-1",
      "2026-01-01",
      [
        {
          finding_code: "F1",
          finding_type_text: "Nodule",
          site_code: null,
          body_site_text: null,
          reason: "resolved-code-only",
          source_anchor: "",
          confidence: 0.9,
        },
        {
          finding_code: null,
          finding_type_text: "Missing",
          site_code: null,
          body_site_text: null,
          reason: "unmatched",
          source_anchor: "",
          confidence: 0.1,
        },
      ],
      [
        {
          finding_code: "F1",
          finding_type_text: "Nodule",
          site_code: "LUNG",
          body_site_text: "Lung",
          finding_type_id: "ft-1",
          body_site_id: "bs-1",
        },
      ],
      {
        repository,
        lookupIcdCode: async () => null,
        log: {
          log: () => {},
          warn: (...args: unknown[]) => warnings.push(args.map((item) => String(item)).join(" ")),
          error: (...args: unknown[]) => errors.push(args.map((item) => String(item)).join(" ")),
        },
      },
    );

    assertEquals(warnings.length > 0, true);
    assertEquals(errors.length > 0, true);
  },
);

Deno.test("processConditionsToResolve logs insert failures", async () => {
  const { repository } = createResolutionRepository({
    throwOnInsertConditionRecord: true,
  });
  const errors: string[] = [];

  await processConditionsToResolve(
    "record-1",
    [
      {
        condition_id: "cond-1",
        reason: "resolved",
        source_anchor: "line",
        confidence: 0.9,
      },
    ],
    [
      {
        id: "cond-1",
        name: "Condition",
        code: null,
        current_status: "active",
        onset_date: null,
        resolved_date: null,
      },
    ],
    {
      repository,
      lookupIcdCode: async () => null,
      log: {
        log: () => {},
        warn: () => {},
        error: (...args: unknown[]) => errors.push(args.map((item) => String(item)).join(" ")),
      },
    },
  );

  assertEquals(errors.length > 0, true);
});
