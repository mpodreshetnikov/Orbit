// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import {
  processConditionsToResolve,
  processExtractedConditions,
  processFindingsToResolve,
} from "./resolution.ts";
import type { ResolutionRepository } from "./resolution.ts";
import type { ExistingCondition, ExistingFinding, ExtractedCondition } from "./types.ts";

interface ResolutionState {
  conditionRecords: Record<string, unknown>[];
  recomputedIds: string[];
  insertedFindings: Record<string, unknown>[];
}

function createResolutionRepository(
  options: {
    throwOnInsertFinding?: boolean;
    throwOnInsertConditionRecord?: boolean;
  } = {},
): { repository: ResolutionRepository; state: ResolutionState } {
  const state: ResolutionState = {
    conditionRecords: [],
    recomputedIds: [],
    insertedFindings: [],
  };

  const repository: ResolutionRepository = {
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

Deno.test("processExtractedConditions proposes rather than writing to the chart", async () => {
  const { repository, state } = createResolutionRepository();

  const conditions: ExtractedCondition[] = [
    {
      existing_condition_id: "cond-existing",
      name: "Diabetes",
      icd_code: "E11.9",
      status: "active",
      confidence: 0.8,
      source_anchor: "line 1",
    },
    {
      existing_condition_id: null,
      name: "Asthma",
      icd_code: "J45",
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

  await processExtractedConditions("record-1", "person-1", conditions, { repository });

  assertEquals(state.conditionRecords.length, 2);

  // A condition the model matched to an existing row links to it directly.
  assertEquals(state.conditionRecords[0].condition_id, "cond-existing");
  assertEquals(state.conditionRecords[0].proposed_name, null);

  // A condition the chart does not have is a proposal: named, coded, and linked to nothing until
  // a person activates the record.
  assertEquals(state.conditionRecords[1].condition_id, null);
  assertEquals(state.conditionRecords[1].proposed_name, "Asthma");
  assertEquals(state.conditionRecords[1].proposed_icd_code, "J45");
  assertEquals(state.conditionRecords[1].is_user_verified, false);

  // Only the mention of an existing condition can move that condition's status.
  assertEquals(state.recomputedIds, ["cond-existing"]);
});

Deno.test("processExtractedConditions keeps going when one insert fails", async () => {
  const { repository, state } = createResolutionRepository({
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
    { repository },
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
    },
  );

  assertEquals(state.insertedFindings.length, 2);
  // A resolution row says so explicitly and measures nothing; zeros here used to carry that
  // meaning, which made a real measured zero read as resolved.
  assertEquals(state.insertedFindings[0].resolution_status, "resolved");
  assertEquals(state.insertedFindings[0].size_mm, null);
  assertEquals(state.insertedFindings[1].resolution_status, "resolved");
  assertEquals(state.insertedFindings[1].count, null);
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
    },
  );

  assertEquals(state.conditionRecords.length, 1);
  assertEquals(state.conditionRecords[0].status_in_record, "resolved");
  assertEquals(state.recomputedIds, ["cond-1"]);
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
      log: {
        log: () => {},
        warn: () => {},
        error: (...args: unknown[]) => errors.push(args.map((item) => String(item)).join(" ")),
      },
    },
  );

  assertEquals(errors.length > 0, true);
});
