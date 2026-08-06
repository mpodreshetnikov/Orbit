import { buildStagePrompt } from "./prompt.ts";
import { callStageJson } from "./client.ts";
import {
  asArray,
  asNullableString,
  asNumber,
  asObject,
  asString,
  isTextGrounded,
  normalizeForGrounding,
} from "./normalize.ts";
import type {
  CatalogContext,
  ExtractResult,
  StageContext,
  StageRejection,
  StageResult,
} from "./types.ts";
import type { ExtractedCondition, ExtractedFinding, ExtractedObservation } from "../types.ts";
import {
  CONDITION_STATUSES,
  coerceConfidence,
  coerceEnum,
  coerceIsoDate,
  coerceNullableEnum,
  LATERALITIES,
  OBSERVATION_STATUSES,
  SEVERITIES,
  type ValueIssue,
} from "./validate.ts";

const SYSTEM_PROMPT = [
  "You are a clinical extraction engine.",
  "You read one document and report only what that document states.",
  "You never infer, complete, or recall clinical facts from outside the document.",
  "Output valid JSON only.",
].join(" ");

/**
 * Strict `json_schema` mode requires `required` to list *every* key in `properties`; a schema that
 * omits one is rejected outright with `invalid_json_schema`, so an "optional" field is expressed as
 * a required nullable instead. Every field below that reads as optional is either nullable or an
 * enum carrying a neutral member (`severity: "unknown"`, `laterality: "none"`), and the normalizers
 * coerce nulls back to the same defaults they applied to absent keys — so requiring the key changes
 * the wire shape, not the meaning.
 */
export const EXTRACT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["observations", "findings", "conditions"],
  properties: {
    observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "obs_code",
          "obs_name_text",
          "value",
          "value_numeric",
          "unit_text",
          "ref_range",
          "ref_range_low",
          "ref_range_high",
          "status",
          "source_anchor",
          "confidence",
        ],
        properties: {
          obs_code: {
            type: ["string", "null"],
            description: "A code from the supplied vocabulary, or null. Never invent one.",
          },
          obs_name_text: {
            type: "string",
            description: "The analyte label exactly as printed in the document.",
          },
          value: { type: "string" },
          value_numeric: { type: ["number", "null"] },
          unit_text: {
            type: ["string", "null"],
            description: "The unit exactly as printed in the document.",
          },
          ref_range: { type: ["string", "null"] },
          ref_range_low: { type: ["number", "null"] },
          ref_range_high: { type: ["number", "null"] },
          status: { type: ["string", "null"], enum: [...OBSERVATION_STATUSES, null] },
          source_anchor: {
            type: "string",
            description: "A short snippet copied verbatim from the document.",
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "finding_code",
          "finding_type_text",
          "site_code",
          "body_site_text",
          "size_mm",
          "count",
          "severity",
          "laterality",
          "morphology",
          "description",
          "histology",
          "finding_date",
          "source_anchor",
          "confidence",
        ],
        properties: {
          finding_code: { type: ["string", "null"] },
          finding_type_text: { type: "string" },
          site_code: { type: ["string", "null"] },
          body_site_text: { type: ["string", "null"] },
          size_mm: { type: ["number", "null"] },
          count: { type: ["number", "null"] },
          severity: { type: "string", enum: SEVERITIES },
          laterality: { type: "string", enum: LATERALITIES },
          morphology: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          histology: { type: ["string", "null"] },
          finding_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          source_anchor: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    conditions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "icd_code", "status", "source_anchor", "confidence"],
        properties: {
          name: { type: "string" },
          icd_code: { type: ["string", "null"] },
          status: { type: "string", enum: CONDITION_STATUSES },
          source_anchor: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

const EXAMPLES = [
  {
    input: "Гемоглобин 97 г/л (норма 120 - 160)",
    output: {
      observations: [
        {
          obs_code: "hemoglobin",
          obs_name_text: "Гемоглобин",
          value: "97",
          value_numeric: 97,
          unit_text: "г/л",
          ref_range: "120 - 160",
          ref_range_low: 120,
          ref_range_high: 160,
          status: "low",
          source_anchor: "Гемоглобин 97 г/л",
          confidence: 0.95,
        },
      ],
      findings: [],
      conditions: [],
    },
  },
  {
    input: "Заключение: полип желчного пузыря 4 мм.",
    output: {
      observations: [],
      findings: [
        {
          finding_code: "polyp",
          finding_type_text: "полип",
          site_code: null,
          body_site_text: "желчного пузыря",
          size_mm: 4,
          count: 1,
          severity: "unknown",
          laterality: "none",
          source_anchor: "полип желчного пузыря 4 мм",
          confidence: 0.9,
        },
      ],
      conditions: [],
    },
  },
];

function buildVocabulary(catalogs: CatalogContext): string {
  // Compact deliberately: the model needs the code and enough label to match it, not the row's
  // identifiers or unit-conversion tables.
  return JSON.stringify({
    observation_codes: catalogs.observationCatalog.map((item) => ({
      code: item.obs_code,
      ru: item.name_ru,
      en: item.name_en,
      unit: item.canonical_unit,
    })),
    finding_codes: catalogs.findingTypeCatalog.map((item) => ({
      code: item.finding_code,
      ru: item.name_ru,
      en: item.name_en,
    })),
    body_site_codes: catalogs.bodySiteCatalog.map((item) => ({
      code: item.site_code,
      ru: item.name_ru,
      en: item.name_en,
    })),
  });
}

function normalizeObservation(item: unknown, issues: ValueIssue[]): ExtractedObservation | null {
  const obj = asObject(item);
  // Prefer the verbatim label; fall back to the legacy field name so a model that answers in the
  // old shape is still usable.
  const obsName = asNullableString(obj.obs_name_text) ?? asNullableString(obj.obs_name);
  if (!obsName) return null;

  return {
    obs_code: asNullableString(obj.obs_code),
    obs_name: obsName,
    value: asString(obj.value, ""),
    value_numeric: asNumber(obj.value_numeric),
    unit: asNullableString(obj.unit_text) ?? asNullableString(obj.unit),
    ref_range: asNullableString(obj.ref_range),
    ref_range_low: asNumber(obj.ref_range_low),
    ref_range_high: asNumber(obj.ref_range_high),
    status: coerceNullableEnum(obj.status, OBSERVATION_STATUSES, "observation.status", issues),
    confidence: coerceConfidence(obj.confidence),
    source_anchor: asNullableString(obj.source_anchor),
  };
}

function normalizeFinding(item: unknown, issues: ValueIssue[]): ExtractedFinding | null {
  const obj = asObject(item);
  const findingTypeText = asNullableString(obj.finding_type_text);
  const sourceAnchor = asNullableString(obj.source_anchor);
  if (!findingTypeText || !sourceAnchor) return null;

  return {
    finding_code: asNullableString(obj.finding_code),
    finding_type_text: findingTypeText,
    site_code: asNullableString(obj.site_code),
    body_site_text: asNullableString(obj.body_site_text),
    size_mm: asNumber(obj.size_mm),
    count: asNumber(obj.count),
    severity: coerceEnum(obj.severity, SEVERITIES, "unknown", "finding.severity", issues),
    laterality: coerceEnum(obj.laterality, LATERALITIES, "none", "finding.laterality", issues),
    morphology: asNullableString(obj.morphology),
    description: asNullableString(obj.description),
    histology: asNullableString(obj.histology),
    finding_date: coerceIsoDate(obj.finding_date, "finding.finding_date", issues),
    source_anchor: sourceAnchor,
    confidence: coerceConfidence(obj.confidence),
  };
}

function normalizeCondition(item: unknown, issues: ValueIssue[]): ExtractedCondition | null {
  const obj = asObject(item);
  const name = asNullableString(obj.name);
  if (!name) return null;

  return {
    // Extraction never resolves to an existing chart row; it does not know the chart exists.
    existing_condition_id: null,
    name,
    icd_code: asNullableString(obj.icd_code),
    status: coerceEnum(obj.status, CONDITION_STATUSES, "suspected", "condition.status", issues),
    confidence: coerceConfidence(obj.confidence),
    source_anchor: asNullableString(obj.source_anchor),
  };
}

/**
 * Verify a quoted anchor actually occurs in the document.
 *
 * An entity whose evidence is not present did not come from the document, whatever the model
 * asserted. This is a deterministic check on purpose — asking a model to confirm its own
 * grounding is far weaker than looking.
 *
 * Comparison is token-based rather than character-exact. The check exists to catch invention, and
 * a model that reformats a dash while quoting has still quoted the document; failing it there
 * discards a correct value. See `normalizeForGrounding`.
 */
function anchorIsGrounded(anchor: string | null | undefined, haystackNormalized: string): boolean {
  if (!anchor) return false;
  return isTextGrounded(anchor, haystackNormalized);
}

/**
 * Stage B — extract clinical entities from the document.
 *
 * Receives the catalogue vocabulary and the document text. It deliberately does **not** receive
 * the patient's existing conditions, findings or checkups: a model shown a list of plausible
 * conditions the patient already has will sooner or later report one of them as found in the
 * document. There is no parameter here through which that context could arrive, and adding one
 * would reintroduce the failure.
 */
export async function runExtractStage(
  ocrText: string,
  catalogs: CatalogContext,
  ctx: StageContext,
): Promise<StageResult<ExtractResult>> {
  const userPrompt = buildStagePrompt({
    instructions: [
      "Extract clinical entities from the document below.",
      "Report only what this document states. Do not infer, complete, or recall anything from outside it.",
      "For every entity, copy a short verbatim snippet from the document into source_anchor as evidence.",
      "Record labels and units exactly as printed, in the document's own language, in obs_name_text and unit_text.",
      "Set obs_code, finding_code and site_code only when the vocabulary below contains a genuine match; otherwise use null.",
      "A null code is always better than an invented one — codes are resolved downstream and a wrong code is worse than none.",
      "If a label is illegible or ambiguous, omit that entity entirely rather than guessing.",
    ],
    schema: EXTRACT_SCHEMA,
    examples: EXAMPLES,
    vocabulary: { label: "CODE_VOCABULARY", content: buildVocabulary(catalogs) },
    variable: [{ label: "DOCUMENT_TEXT", content: ocrText, untrusted: true }],
  });

  const result = await callStageJson(
    SYSTEM_PROMPT,
    userPrompt,
    EXTRACT_SCHEMA,
    "health_clinical_extraction",
    ctx,
  );

  const rejected: StageRejection[] = [];
  const valueIssues: ValueIssue[] = [];
  const groundingHaystack = normalizeForGrounding(ocrText);

  const observations: ExtractedObservation[] = [];
  for (const item of asArray(result.parsed.observations)) {
    const normalized = normalizeObservation(item, valueIssues);
    if (!normalized) {
      rejected.push({ entityKind: "observation", reason: "missing analyte label" });
      continue;
    }
    if (!anchorIsGrounded(normalized.source_anchor, groundingHaystack)) {
      rejected.push({
        entityKind: "observation",
        reason: "source anchor not found in document text",
      });
      continue;
    }
    observations.push(normalized);
  }

  const findings: ExtractedFinding[] = [];
  for (const item of asArray(result.parsed.findings)) {
    const normalized = normalizeFinding(item, valueIssues);
    if (!normalized) {
      rejected.push({ entityKind: "finding", reason: "missing finding label or source anchor" });
      continue;
    }
    if (!anchorIsGrounded(normalized.source_anchor, groundingHaystack)) {
      rejected.push({ entityKind: "finding", reason: "source anchor not found in document text" });
      continue;
    }
    findings.push(normalized);
  }

  const conditions: ExtractedCondition[] = [];
  for (const item of asArray(result.parsed.conditions)) {
    const normalized = normalizeCondition(item, valueIssues);
    if (!normalized) {
      rejected.push({ entityKind: "condition", reason: "missing condition name" });
      continue;
    }
    if (!anchorIsGrounded(normalized.source_anchor, groundingHaystack)) {
      rejected.push({
        entityKind: "condition",
        reason: "source anchor not found in document text",
      });
      continue;
    }
    conditions.push(normalized);
  }

  // Value-level defects do not drop the entity; they replace one attribute with the column's
  // default and are reported so the review screen can flag them.
  for (const issue of valueIssues) {
    rejected.push({
      entityKind: issue.field,
      reason: `unrecognised value replaced with ${issue.appliedFallback}`,
    });
  }

  return {
    value: { observations, findings, conditions },
    usage: result.usage,
    finishReason: result.finishReason,
    rejected,
  };
}
