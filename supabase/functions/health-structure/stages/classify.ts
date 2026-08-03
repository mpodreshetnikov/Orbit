import { buildStagePrompt } from "./prompt.ts";
import { callStageJson } from "./client.ts";
import { ALLOWED_RECORD_TYPES, asString, asStringArray, normalizeRecordType } from "./normalize.ts";
import { coerceIsoDate, type ValueIssue } from "./validate.ts";
import type { ClassifyResult, StageContext, StageResult } from "./types.ts";

const SYSTEM_PROMPT = [
  "You classify and summarise medical documents.",
  "You describe the document as a whole; you do not extract individual measurements.",
  "Output valid JSON only.",
].join(" ");

export const CLASSIFY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["record_type", "title", "record_date", "summary", "keywords"],
  properties: {
    record_type: { type: "string", enum: [...ALLOWED_RECORD_TYPES] },
    title: { type: "string", description: "Short human-readable document title." },
    record_date: {
      type: ["string", "null"],
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description: "Date the document describes, not the date it was scanned.",
    },
    summary: { type: "string", description: "Two or three sentences, factual, no advice." },
    keywords: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
};

const EXAMPLES = [
  {
    input: "Клинический анализ крови от 05.01.2026. Гемоглобин 97 г/л (норма 120-160).",
    output: {
      record_type: "lab",
      title: "Клинический анализ крови",
      record_date: "2026-01-05",
      summary: "Complete blood count. Haemoglobin is below the stated reference range.",
      keywords: ["blood count", "haemoglobin"],
    },
  },
  {
    input: "Ultrasound of the abdomen. No focal lesions identified.",
    output: {
      record_type: "imaging",
      title: "Abdominal ultrasound",
      record_date: null,
      summary: "Abdominal ultrasound reporting no focal lesions.",
      keywords: ["ultrasound", "abdomen"],
    },
  },
];

/**
 * Stage A — decide what kind of document this is and describe it.
 *
 * Takes the document text and nothing else: no catalogue, because no codes are assigned here,
 * and no patient context, because none of it bears on what kind of document this is.
 */
export async function runClassifyStage(
  ocrText: string,
  ctx: StageContext,
): Promise<StageResult<ClassifyResult>> {
  const userPrompt = buildStagePrompt({
    instructions: [
      "Read the document below and describe it as a whole.",
      "Decide its type, give it a short title, find the date it describes, summarise it, and list a few keywords.",
      "Base every field only on what the document states. Where it states nothing, emit null or an empty list.",
    ],
    schema: CLASSIFY_SCHEMA,
    examples: EXAMPLES,
    variable: [{ label: "DOCUMENT_TEXT", content: ocrText, untrusted: true }],
  });

  const result = await callStageJson(
    SYSTEM_PROMPT,
    userPrompt,
    CLASSIFY_SCHEMA,
    "health_document_classification",
    ctx,
  );

  const raw = result.parsed;
  // record_date lands in a `date` column. Anything that is not a real calendar date - "March
  // 2026", "не указано", "2026-02-31" - used to reach the database and fail the whole update,
  // after the model call had already been paid for.
  const issues: ValueIssue[] = [];
  const recordDate = coerceIsoDate(raw.record_date, "record.record_date", issues);

  return {
    value: {
      record_type: normalizeRecordType(raw.record_type),
      title: asString(raw.title, "Medical document"),
      record_date: recordDate,
      summary: asString(raw.summary, ""),
      keywords: asStringArray(raw.keywords),
    },
    usage: result.usage,
    finishReason: result.finishReason,
    rejected: issues.map((issue) => ({
      entityKind: issue.field,
      reason: `unrecognised value replaced with ${issue.appliedFallback}`,
    })),
  };
}
