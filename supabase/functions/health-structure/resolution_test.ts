// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import {
  processConditionsToResolve,
  processExtractedConditions,
  processFindingsToResolve,
} from "./resolution.ts";
import type { ResolutionRepository } from "./resolution.ts";
import type {
  ConditionToResolve,
  ExistingCondition,
  ExistingFinding,
  ExtractedCondition,
  ExtractedObservation,
} from "./types.ts";

/**
 * One extracted observation, defaulting to case 001's B12 row: 704 pg/mL against a printed
 * 187–883. Overriding one field at a time keeps each test's subject visible.
 */
function observation(overrides: Partial<ExtractedObservation> = {}): ExtractedObservation {
  return {
    obs_code: "vitamin_b12",
    obs_name: "Витамин B12",
    value: "704",
    value_numeric: 704,
    unit: "пг/мл",
    ref_range: "187-883",
    ref_range_low: 187,
    ref_range_high: 883,
    status: "normal",
    confidence: 0.9,
    ...overrides,
  };
}

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
      name: "Дефицит витамина B12",
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
        supporting_obs_code: "vitamin_b12",
        reason: "skip-empty",
        source_anchor: "line",
        confidence: 0.1,
      },
      {
        condition_id: "cond-1",
        supporting_obs_code: "vitamin_b12",
        reason: "resolved",
        source_anchor: "line",
        confidence: 0.9,
      },
      {
        condition_id: "missing",
        supporting_obs_code: "vitamin_b12",
        reason: "skip",
        source_anchor: "line",
        confidence: 0.1,
      },
    ],
    existingConditions,
    [observation({ obs_code: "vitamin_b12", value_numeric: 704 })],
    {
      repository,
    },
  );

  assertEquals(state.conditionRecords.length, 1);
  assertEquals(state.conditionRecords[0].status_in_record, "resolved");
  assertEquals(state.conditionRecords[0].supporting_obs_code, "vitamin_b12");
  assertEquals(state.conditionRecords[0].review_decision, "pending");
  assertEquals(state.conditionRecords[0].is_user_verified, false);
  assertEquals(state.recomputedIds, ["cond-1"]);
});

/**
 * The gate, exercised through the function that writes rather than only through `checkLabResolution`.
 *
 * A rejection that is never consulted by the caller is not a gate, and testing the predicate alone
 * cannot tell the two apart: every case below asserts that nothing was written, not merely that a
 * reason was returned.
 */
function b12Condition(overrides: Partial<ExistingCondition> = {}): ExistingCondition {
  return {
    id: "cond-b12",
    name: "Дефицит витамина B12",
    code: "E53.8",
    current_status: "active",
    onset_date: null,
    resolved_date: null,
    ...overrides,
  };
}

async function runGate(
  toResolve: Partial<ConditionToResolve>,
  conditions: ExistingCondition[],
  observations: ExtractedObservation[],
) {
  const { repository, state } = createResolutionRepository();
  const rejected = await processConditionsToResolve(
    "record-1",
    [
      {
        condition_id: conditions[0].id,
        supporting_obs_code: null,
        reason: "in range",
        source_anchor: "line",
        confidence: 0.9,
        ...toResolve,
      },
    ],
    conditions,
    observations,
    { repository },
  );
  return { rejected, state };
}

Deno.test("a sibling ICD code under the same parent does not match", async () => {
  // E53.0 is riboflavin and E53.1 is pyridoxine. Both sit under E53 with B12, and neither is
  // measured by a B12 assay, so a prefix wide enough to reach them would close a deficiency this
  // document says nothing about. The name has to be foreign to B12 as well, or the second list
  // would permit what the first refused.
  const { rejected, state } = await runGate(
    { supporting_obs_code: "vitamin_b12" },
    [b12Condition({ id: "cond-b6", name: "Дефицит пиридоксина", code: "E53.1" })],
    [observation({ obs_code: "vitamin_b12", value_numeric: 704 })],
  );

  assertEquals(state.conditionRecords.length, 0);
  assertEquals(
    rejected.map((item) => item.reason),
    ["analyte does not match this condition"],
  );
});

Deno.test("a resolution citing nothing is dropped", async () => {
  const { rejected, state } = await runGate(
    { supporting_obs_code: null },
    [b12Condition()],
    [observation({ obs_code: "vitamin_b12", value_numeric: 704 })],
  );

  assertEquals(state.conditionRecords.length, 0);
  assertEquals(
    rejected.map((item) => item.reason),
    ["no supporting observation cited"],
  );
});

Deno.test("a resolution citing an analyte the table does not carry is dropped", async () => {
  // Every lipid on case 001 is in range, and an in-range panel under management is control rather
  // than cure. The table's silence is what refuses it.
  const { rejected, state } = await runGate(
    { supporting_obs_code: "cholesterol_total" },
    [b12Condition({ id: "cond-lipid", name: "Дислипидемия", code: "E78.5" })],
    [observation({ obs_code: "cholesterol_total", value_numeric: 4.2 })],
  );

  assertEquals(state.conditionRecords.length, 0);
  assertEquals(
    rejected.map((item) => item.reason),
    ["analyte cannot resolve a condition"],
  );
});

Deno.test("a permitted analyte cited against an unrelated condition is dropped", async () => {
  // The case the gate exists for: cited, permitted, present and in range, and about a different
  // condition entirely. Every check but the matcher passes.
  const { rejected, state } = await runGate(
    { supporting_obs_code: "vitamin_b12" },
    [b12Condition({ id: "cond-lipid", name: "Дислипидемия", code: "E78.5" })],
    [observation({ obs_code: "vitamin_b12", value_numeric: 704 })],
  );

  assertEquals(state.conditionRecords.length, 0);
  assertEquals(
    rejected.map((item) => item.reason),
    ["analyte does not match this condition"],
  );
});

Deno.test("a condition with no ICD code still matches on its name", async () => {
  // `conditions.code` is nullable and routinely null, which is why the matcher carries two lists.
  // The name here is spelled with a Cyrillic В, as a Russian lab prints it.
  const { rejected, state } = await runGate(
    { supporting_obs_code: "vitamin_b12" },
    [b12Condition({ code: null, name: "Дефицит витамина В12" })],
    [observation({ obs_code: "vitamin_b12", value_numeric: 704 })],
  );

  assertEquals(rejected, []);
  assertEquals(state.conditionRecords.length, 1);
});

Deno.test("an entry requiring two analytes is not satisfied by one", async () => {
  const { rejected, state } = await runGate(
    { supporting_obs_code: "ferritin" },
    [b12Condition({ id: "cond-ida", name: "Железодефицитная анемия", code: "D50.9" })],
    [
      observation({
        obs_code: "ferritin",
        value_numeric: 60,
        ref_range_low: 10,
        ref_range_high: 120,
      }),
    ],
  );

  assertEquals(state.conditionRecords.length, 0);
  assertEquals(
    rejected.map((item) => item.reason),
    ["required observation absent from this document"],
  );
});

Deno.test("a resolution citing an out-of-range observation is dropped", async () => {
  const { rejected, state } = await runGate(
    { supporting_obs_code: "vitamin_b12" },
    [b12Condition()],
    [observation({ obs_code: "vitamin_b12", value_numeric: 120 })],
  );

  assertEquals(state.conditionRecords.length, 0);
  assertEquals(
    rejected.map((item) => item.reason),
    ["supporting observation is not in range"],
  );
});

Deno.test("a printed range decides, and an unreadable value never passes", async () => {
  // The document's own range beats the extracted status, and a status of `normal` cannot rescue a
  // value that contradicts it.
  const contradicted = await runGate(
    { supporting_obs_code: "vitamin_b12" },
    [b12Condition()],
    [observation({ obs_code: "vitamin_b12", value_numeric: 900, status: "normal" })],
  );
  assertEquals(contradicted.state.conditionRecords.length, 0);

  // No number to compare, with a range printed: not in range rather than passing.
  const unreadable = await runGate(
    { supporting_obs_code: "vitamin_b12" },
    [b12Condition()],
    [observation({ obs_code: "vitamin_b12", value_numeric: null, status: "normal" })],
  );
  assertEquals(unreadable.state.conditionRecords.length, 0);

  // No range printed: the extracted status is the fallback, and only `normal` passes.
  const statusOnly = await runGate(
    { supporting_obs_code: "vitamin_b12" },
    [b12Condition()],
    [
      observation({
        obs_code: "vitamin_b12",
        value_numeric: null,
        ref_range_low: null,
        ref_range_high: null,
        status: "normal",
      }),
    ],
  );
  assertEquals(statusOnly.state.conditionRecords.length, 1);

  const statusUnknown = await runGate(
    { supporting_obs_code: "vitamin_b12" },
    [b12Condition()],
    [
      observation({
        obs_code: "vitamin_b12",
        value_numeric: null,
        ref_range_low: null,
        ref_range_high: null,
        status: "unknown",
      }),
    ],
  );
  assertEquals(statusUnknown.state.conditionRecords.length, 0);
});

Deno.test("a repeated analyte must be in range every time it appears", async () => {
  const { rejected, state } = await runGate(
    { supporting_obs_code: "vitamin_b12" },
    [b12Condition()],
    [
      observation({ obs_code: "vitamin_b12", value_numeric: 704 }),
      observation({ obs_code: "vitamin_b12", value_numeric: 120 }),
    ],
  );

  assertEquals(state.conditionRecords.length, 0);
  assertEquals(
    rejected.map((item) => item.reason),
    ["supporting observation is not in range"],
  );
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
        supporting_obs_code: "vitamin_b12",
        reason: "resolved",
        source_anchor: "line",
        confidence: 0.9,
      },
    ],
    [
      {
        id: "cond-1",
        name: "Дефицит витамина B12",
        code: null,
        current_status: "active",
        onset_date: null,
        resolved_date: null,
      },
    ],
    [observation()],
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
