import { buildStagePrompt } from "./prompt.ts";
import { callStageJson } from "./client.ts";
import { asArray, asNullableString, asNumber, asObject, asString } from "./normalize.ts";
import {
  EMPTY_RECONCILE,
  emptyUsage,
  type ExtractResult,
  type PatientStateContext,
  type ReconcileResult,
  type StageContext,
  type StageResult,
} from "./types.ts";

const SYSTEM_PROMPT = [
  "You reconcile newly extracted clinical entities against a patient's existing record.",
  "You only match, or decline to match. You never introduce entities of your own.",
  "Output valid JSON only.",
].join(" ");

/** Every key listed in `required` — see the note on `EXTRACT_SCHEMA` for why strict mode demands it. */
export const RECONCILE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["findings_to_resolve", "conditions_to_resolve", "checkups_to_complete"],
  properties: {
    findings_to_resolve: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "finding_code",
          "finding_type_text",
          "site_code",
          "body_site_text",
          "reason",
          "source_anchor",
          "confidence",
        ],
        properties: {
          finding_code: { type: ["string", "null"] },
          finding_type_text: { type: "string" },
          site_code: { type: ["string", "null"] },
          body_site_text: { type: ["string", "null"] },
          reason: { type: "string" },
          source_anchor: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    conditions_to_resolve: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition_id", "supporting_obs_code", "reason", "source_anchor", "confidence"],
        properties: {
          condition_id: {
            type: "string",
            description: "Must be one of the supplied existing condition ids.",
          },
          supporting_obs_code: {
            type: ["string", "null"],
            description:
              "The catalogue code of the observation whose value establishes this resolution, or null when no measurement does.",
          },
          reason: { type: "string" },
          source_anchor: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    checkups_to_complete: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["checkup_item_id", "reason", "suggested_done_at"],
        properties: {
          checkup_item_id: {
            type: "string",
            description: "Must be one of the supplied checkup item ids.",
          },
          reason: { type: "string" },
          suggested_done_at: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
      },
    },
  },
};

/** True when there is nothing on the patient's record to reconcile against. */
export function hasNothingToReconcile(patient: PatientStateContext): boolean {
  return (
    patient.existingConditions.length === 0 &&
    patient.existingFindings.length === 0 &&
    patient.checkupItems.length === 0
  );
}

function buildExtractedSummary(extracted: ExtractResult, recordDate: string | null): string {
  // Anchors are included as evidence but the document itself is not: this stage matches what
  // extraction already committed to, and must not be able to introduce document content.
  return JSON.stringify({
    record_date: recordDate,
    // The anchor travels with the observation for the same reason it travels with a finding: a
    // resolution has to cite the document, and this stage cannot see the document. Without it the
    // only way to fill `source_anchor` for a lab-driven closure is to compose one out of the code,
    // the value and the unit — which is what the model did, and what a reviewer was then shown as
    // a quotation from their own medical record. Extraction verifies each anchor against the
    // document text and drops the observation when it cannot be found, so this is the one string
    // here that is known to appear in the document verbatim.
    observations: extracted.observations.map((item) => ({
      name: item.obs_name,
      code: item.obs_code,
      value: item.value,
      unit: item.unit,
      status: item.status,
      anchor: item.source_anchor ?? null,
    })),
    findings: extracted.findings.map((item) => ({
      code: item.finding_code,
      text: item.finding_type_text,
      site_code: item.site_code,
      site_text: item.body_site_text,
      anchor: item.source_anchor,
    })),
    conditions: extracted.conditions.map((item) => ({
      name: item.name,
      icd_code: item.icd_code,
      status: item.status,
      anchor: item.source_anchor,
    })),
    // The findings the document says are *gone*, which is the only kind of evidence that can close
    // one. Extraction reports what is present, so before this existed `Конкременты: нет` produced
    // no entity and reached nothing — and this stage was being asked which existing findings had
    // resolved while being shown only presences. That is why `findings_to_resolve` could never fire
    // on the evidence it exists for.
    //
    // This does not weaken the stage's blindness to the document. It is still a derived signal from
    // extraction, in the same shape as everything else here, and still carries an anchor rather than
    // prose. Passing the document text through would be the shortcut; this is not that.
    asserted_absences: extracted.asserted_absences.map((item) => ({
      code: item.finding_code,
      text: item.finding_type_text,
      site_code: item.site_code,
      site_text: item.body_site_text,
      anchor: item.source_anchor,
    })),
  });
}

function buildPatientState(patient: PatientStateContext): string {
  return JSON.stringify({
    existing_conditions: patient.existingConditions.map((item) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      status: item.current_status,
    })),
    existing_findings: patient.existingFindings.map((item) => ({
      finding_code: item.finding_code,
      finding_type_text: item.finding_type_text,
      site_code: item.site_code,
      body_site_text: item.body_site_text,
    })),
    checkup_items: patient.checkupItems.map((item) => ({
      id: item.id,
      title: item.title,
      next_due_at: item.next_due_at,
    })),
  });
}

/**
 * Stage D — reconcile extracted entities against the patient's existing record.
 *
 * Receives the entities stage B produced and the patient's current state. It deliberately does
 * **not** receive the document text: this is a matching problem, and withholding the document
 * means the stage can only match what extraction already found, or decline. Skipped entirely
 * when the patient has nothing to reconcile against, which saves a request outright.
 */
export async function runReconcileStage(
  extracted: ExtractResult,
  recordDate: string | null,
  patient: PatientStateContext,
  ctx: StageContext,
): Promise<StageResult<ReconcileResult>> {
  if (hasNothingToReconcile(patient)) {
    return { value: EMPTY_RECONCILE, usage: emptyUsage(), finishReason: null, rejected: [] };
  }

  const userPrompt = buildStagePrompt({
    instructions: [
      "Compare the newly extracted entities against the patient's existing record.",
      "Report which existing findings this document shows to have resolved, which existing conditions it shows to have resolved, and which scheduled checkups it completes.",
      "Only reference ids that appear in the patient record below. Never invent an id.",
      "Only report a resolution when the extracted entities positively support it. Absence of a mention is not evidence of resolution.",
      "For findings, asserted_absences is the only thing that positively supports a resolution: it lists findings this document explicitly states are NOT present. An existing finding matched by an asserted absence of the same finding at the same site has been shown to have resolved — that is what 'Конкременты: нет' means about a stone already on the record.",
      "An absence asserted for a whole organ covers its parts: no stones in the kidneys means no stone in the right kidney, so site_code 'kidney' resolves an existing finding on 'kidney_right'. The reverse does not hold — an absence asserted for one part says nothing about another part, and an absence in a different organ says nothing at all. When the sides are named separately and only one is clear, resolve only that one.",
      "For conditions, a measurement is the other thing that positively supports one. A condition whose definition IS a specific substance being deficient has resolved when that exact substance is measured in this document and is inside its reference range. Set supporting_obs_code to the code of the observation you relied on. A resolution without it will be discarded.",
      "Three things are not that, and they are what this rule is most often mistaken for. A condition that is managed rather than cured — an in-range value under treatment shows control, not resolution, so treated hypothyroidism is not resolved by a normal TSH and controlled diabetes is not resolved by a normal HbA1c. A condition diagnosed by imaging or histology — a blood test cannot exclude what a scan or a biopsy established, so normal liver enzymes do not resolve fatty liver disease. And a condition whose defining measurement is simply not in this document — silence is not evidence, and an in-range value for some other analyte is not evidence about this condition.",
      "source_anchor must be copied verbatim from the anchor field of the entity you relied on. Every observation, finding and asserted absence carries one, and each was checked against the document text. Never assemble an anchor out of a code, a value and a unit: it is shown to a person as what their document says, and a sentence their document does not contain is not that.",
      "When nothing matches, return empty arrays. Empty is the correct and expected answer in most cases.",
    ],
    schema: RECONCILE_SCHEMA,
    // One worked example, and every entity in it is absent from the evaluation corpus on purpose.
    // Built from case 001's own conditions it would teach the model to recall this prompt rather
    // than to read the document, and the corpus would report a success it had not earned. The
    // corpus holds a biochemistry and lipid panel, a renal ultrasound and a gastrointestinal
    // biopsy; this is a thyroid and vitamin panel, and it carries the whole distinction in one
    // pair -- the deficiency defined by its measurement closes, the treated condition whose
    // measurement is normal *because* it is treated does not.
    examples: [
      {
        input: JSON.stringify({
          extracted: {
            observations: [
              {
                code: "vitamin_d_25oh",
                value: "48",
                unit: "ng/mL",
                status: "normal",
                anchor: "25-ОН витамин D — 48 нг/мл (норма 30–100)",
              },
              {
                code: "tsh",
                value: "2.1",
                unit: "мЕд/л",
                status: "normal",
                anchor: "ТТГ — 2.1 мЕд/л",
              },
            ],
          },
          patient: {
            existing_conditions: [
              { id: "cond-a", name: "Дефицит витамина D", code: "E55.9", status: "active" },
              { id: "cond-b", name: "Гипотиреоз", code: "E03.9", status: "active" },
            ],
          },
        }),
        output: {
          findings_to_resolve: [],
          conditions_to_resolve: [
            {
              condition_id: "cond-a",
              supporting_obs_code: "vitamin_d_25oh",
              reason:
                "The deficiency is the statement that this substance is low, and it is measured here inside its range.",
              // Copied character for character from that observation's anchor, not rebuilt from
              // its code and value. This is the half of the example that is easiest to imitate
              // loosely and the most damaging to get wrong.
              source_anchor: "25-ОН витамин D — 48 нг/мл (норма 30–100)",
              confidence: 0.9,
            },
          ],
          checkups_to_complete: [],
        },
      },
    ],
    variable: [
      {
        label: "EXTRACTED_ENTITIES",
        content: buildExtractedSummary(extracted, recordDate),
        untrusted: false,
      },
      { label: "PATIENT_RECORD", content: buildPatientState(patient), untrusted: false },
    ],
  });

  const result = await callStageJson(
    SYSTEM_PROMPT,
    userPrompt,
    RECONCILE_SCHEMA,
    "health_state_reconciliation",
    ctx,
  );

  const rejected: StageResult<ReconcileResult>["rejected"] = [];
  const knownConditionIds = new Set(patient.existingConditions.map((item) => item.id));
  const knownCheckupIds = new Set(patient.checkupItems.map((item) => item.id));

  const findingsToResolve = asArray(result.parsed.findings_to_resolve).map((item) => {
    const obj = asObject(item);
    return {
      finding_code: asNullableString(obj.finding_code),
      finding_type_text: asString(obj.finding_type_text, ""),
      site_code: asNullableString(obj.site_code),
      body_site_text: asNullableString(obj.body_site_text),
      reason: asString(obj.reason, ""),
      source_anchor: asString(obj.source_anchor, ""),
      confidence: asNumber(obj.confidence) ?? 0,
    };
  });

  // Ids are checked against what we supplied rather than trusted. A model-invented id would
  // otherwise silently address a row belonging to someone else, or nothing at all.
  const conditionsToResolve = [];
  for (const item of asArray(result.parsed.conditions_to_resolve)) {
    const obj = asObject(item);
    const conditionId = asString(obj.condition_id, "");
    if (!knownConditionIds.has(conditionId)) {
      rejected.push({ entityKind: "condition_to_resolve", reason: "unknown condition id" });
      continue;
    }
    conditionsToResolve.push({
      condition_id: conditionId,
      supporting_obs_code: asNullableString(obj.supporting_obs_code),
      reason: asString(obj.reason, ""),
      source_anchor: asString(obj.source_anchor, ""),
      confidence: asNumber(obj.confidence) ?? 0,
    });
  }

  const checkupsToComplete = [];
  for (const item of asArray(result.parsed.checkups_to_complete)) {
    const obj = asObject(item);
    const checkupItemId = asString(obj.checkup_item_id, "");
    if (!knownCheckupIds.has(checkupItemId)) {
      rejected.push({ entityKind: "checkup_to_complete", reason: "unknown checkup item id" });
      continue;
    }
    checkupsToComplete.push({
      checkup_item_id: checkupItemId,
      reason: asString(obj.reason, ""),
      suggested_done_at: asString(obj.suggested_done_at, ""),
    });
  }

  return {
    value: {
      findings_to_resolve: findingsToResolve,
      conditions_to_resolve: conditionsToResolve,
      checkups_to_complete: checkupsToComplete,
    },
    usage: result.usage,
    finishReason: result.finishReason,
    rejected,
  };
}
