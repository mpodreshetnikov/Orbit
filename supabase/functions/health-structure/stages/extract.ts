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
  AssertedAbsence,
  CatalogContext,
  ExtractResult,
  StageContext,
  StageRejection,
  StageResult,
} from "./types.ts";
import type {
  ExtractedCondition,
  ExtractedFinding,
  ExtractedObservation,
  ExtractionIssue,
} from "../types.ts";
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
  required: ["observations", "findings", "conditions", "asserted_absences"],
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
    /**
     * Findings the document explicitly states are **not** present.
     *
     * The one kind of evidence that can close an existing finding, and until now the only kind the
     * pipeline threw away. Extraction emits what is present, so `Конкременты: нет` -- the strongest
     * possible statement that a previously recorded stone is gone -- correctly produced no entity
     * and therefore reached nothing. Reconciliation is asked which existing findings this document
     * shows to have resolved and was handed only presences, so `findings_to_resolve` could not fire
     * on the evidence it exists for.
     *
     * Same shape as a finding and grounded the same way, so the anchor check applies unchanged.
     */
    asserted_absences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "finding_code",
          "finding_type_text",
          "site_code",
          "body_site_text",
          "source_anchor",
          "confidence",
        ],
        properties: {
          finding_code: { type: ["string", "null"] },
          finding_type_text: { type: "string" },
          site_code: { type: ["string", "null"] },
          body_site_text: { type: ["string", "null"] },
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
      asserted_absences: [],
    },
  },
  // Demonstrates the coded branch: `polyp` is in the vocabulary, so finding_type_text is the
  // vocabulary's own spelling rather than the document's.
  {
    input: "Заключение: полип желчного пузыря 4 мм.",
    output: {
      observations: [],
      findings: [
        {
          finding_code: "polyp",
          finding_type_text: "Полип",
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
      asserted_absences: [],
    },
  },
  // Demonstrates the uncoded branch: nothing in the vocabulary means a kink, so the code stays
  // null and finding_type_text is the document's own wording — not a paraphrase, and not the
  // nearest vocabulary entry.
  {
    input: "УЗИ: перегиб в области тела желчного пузыря.",
    output: {
      observations: [],
      findings: [
        {
          finding_code: null,
          finding_type_text: "перегиб",
          site_code: null,
          body_site_text: "тела желчного пузыря",
          size_mm: null,
          count: null,
          severity: "unknown",
          laterality: "none",
          source_anchor: "перегиб в области тела желчного пузыря",
          confidence: 0.9,
        },
      ],
      conditions: [],
      asserted_absences: [],
    },
  },
  // Demonstrates three things at once, and deliberately uses a document unlike any in the eval
  // corpus — a thyroid report, where the corpus holds a lipid panel, a renal ultrasound and a GI
  // biopsy. An example drawn from a corpus case would measure the model's memory of this prompt
  // rather than its reading of the document. The gallbladder example above is off-corpus for the
  // same reason.
  //
  //   1. `умеренно выраженная` is a grade, so severity is `moderate` rather than `unknown`.
  //   2. The conclusion sentence is long; the condition `name` keeps only the diagnosis, and the
  //      anatomy stays on the finding that carries it.
  //   3. The serology line is a qualitative positive with no measured value, so it is omitted
  //      entirely rather than becoming a finding sited to the thyroid.
  {
    input:
      "УЗИ щитовидной железы: умеренно выраженная диффузная гиперплазия правой доли.\nАнтитела к ТПО: положительно.\nЗаключение: узловой зоб щитовидной железы с признаками аутоиммунного тиреоидита.",
    output: {
      observations: [],
      findings: [
        {
          finding_code: "hypertrophy",
          finding_type_text: "Гипертрофия",
          site_code: null,
          body_site_text: "правой доли щитовидной железы",
          size_mm: null,
          count: 1,
          severity: "moderate",
          laterality: "right",
          source_anchor: "умеренно выраженная диффузная гиперплазия правой доли",
          confidence: 0.9,
        },
      ],
      conditions: [
        {
          name: "Узловой зоб",
          icd_code: null,
          status: "active",
          source_anchor: "узловой зоб щитовидной железы",
          confidence: 0.85,
        },
      ],
      asserted_absences: [],
    },
  },
  // Demonstrates asserted_absences, and the line either side of it. Off-corpus again: the corpus
  // holds a renal ultrasound whose absences are stones and extra masses, so this uses a gallbladder
  // study for the same reason the kink example above does.
  //
  //   1. `конкрементов не выявлено` names a specific finding as absent, so it is an asserted
  //      absence -- the one kind of evidence that can close a stone already on the record.
  //   2. `стенка не утолщена` denies a finding too, and is emitted nowhere: it is a denial, so it
  //      is not a finding, and the record carries no "thickened wall" for it to close.
  //   3. The polyp is present and is reported normally, so a document can do all three at once.
  {
    input:
      "УЗИ желчного пузыря: конкрементов не выявлено. Стенка не утолщена. Полип 3 мм в области дна.",
    output: {
      observations: [],
      findings: [
        {
          finding_code: "polyp",
          finding_type_text: "Полип",
          site_code: "gallbladder",
          body_site_text: "области дна желчного пузыря",
          size_mm: 3,
          count: 1,
          severity: "unknown",
          laterality: "none",
          source_anchor: "Полип 3 мм в области дна",
          confidence: 0.9,
        },
      ],
      conditions: [],
      asserted_absences: [
        {
          finding_code: "stone",
          finding_type_text: "Конкремент",
          site_code: "gallbladder",
          body_site_text: "желчного пузыря",
          source_anchor: "конкрементов не выявлено",
          confidence: 0.9,
        },
      ],
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
 * Negations that can govern a term on either side of them.
 *
 * `не` and `нет` sit in predicates, and Russian puts the predicate after its subject as readily as
 * before it: `ЛС не расширена`, `метаплазия не выявлена`, `Конкременты: нет`. Proximity in either
 * direction is the right test for these.
 */
const SYMMETRIC_NEGATION_WORDS = new Set(["не", "нет"]);
const SYMMETRIC_NEGATION_PREFIXES = ["отсутств"];

/**
 * `без` is a preposition, so it governs only the noun phrase that follows it — never one before it.
 *
 * This distinction is load-bearing rather than pedantic. `Полип без дисплазии` is a *present* polyp
 * that happens to lack dysplasia, and it is ordinary pathology phrasing; treating the `без` two
 * words away as negating the polyp deletes a real finding from someone's chart. The same anchor
 * read correctly negates only `дисплазии`, which is what `без признаков дисплазии` relies on.
 */
const PREPOSITIONAL_NEGATION_WORDS = new Set(["без"]);

/** How far from the finding term a negation still governs it. */
const NEGATION_WINDOW = 2;

function anchorWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

function isSymmetricNegation(word: string): boolean {
  return (
    SYMMETRIC_NEGATION_WORDS.has(word) ||
    SYMMETRIC_NEGATION_PREFIXES.some((prefix) => word.startsWith(prefix))
  );
}

/**
 * True when some negation within the window governs the term at `termIndex`.
 *
 * A symmetric negation counts from either side. A preposition counts only when it stands before the
 * term, because that is the only direction it can reach.
 */
function negationGoverns(words: string[], termIndex: number): boolean {
  const from = Math.max(0, termIndex - NEGATION_WINDOW);
  const to = Math.min(words.length - 1, termIndex + NEGATION_WINDOW);
  for (let index = from; index <= to; index++) {
    if (index === termIndex) continue;
    const word = words[index];
    if (isSymmetricNegation(word)) return true;
    if (PREPOSITIONAL_NEGATION_WORDS.has(word) && index < termIndex) return true;
  }
  return false;
}

/**
 * True when the anchor denies the finding rather than reporting it.
 *
 * A guard, not a substitute for the instruction. `ЛС не расширена` — the pyelocaliceal system is
 * **not** dilated — was extracted as a positive finding, turning a statement that nothing is wrong
 * into a record that something is. An instruction alone leaves that one sampling away from coming
 * back, and this failure is invisible on the review screen: the row looks like any other.
 *
 * Cheap and reliable because it reads `source_anchor`, a short verbatim quote already validated as
 * occurring in the document. It is not parsing free prose — it is reading the sentence the model
 * itself nominated as its evidence.
 *
 * Adjacency is the whole difficulty. A negation anywhere in the anchor is the obvious rule and it
 * is wrong: case 002's legitimate `гиперсигналы` finding is anchored on
 * `с обеих сторон единичные гиперсигналы 0,2 см, без эхотени`, where `без` negates the acoustic
 * shadow rather than the hypersignals, and a blanket rule would delete a real finding. So the
 * negation has to be near the finding term, which covers the forms that matter in both directions:
 * `не` immediately before (`не расширена`), immediately after (`метаплазия не выявлена`), or a
 * couple of words ahead (`без признаков дисплазии`).
 *
 * When the term cannot be located in the anchor at all, fall back to scanning the whole anchor. An
 * anchor that does not contain the finding's own name is already suspect, and the asymmetry of harm
 * decides the tie: a dropped finding leaves a gap a clinician can see and refill, while a finding
 * the document denied is a false abnormality nothing will prompt anyone to correct.
 */
export function anchorAssertsAbsence(anchor: string, findingTypeText: string): boolean {
  const words = anchorWords(anchor);
  if (words.length === 0) return false;

  const termWords = anchorWords(findingTypeText);
  const termIndexes: number[] = [];
  for (const term of termWords) {
    if (term.length < 4) continue;
    const stem = term.slice(0, Math.max(4, term.length - 2));
    words.forEach((word, index) => {
      if (word.startsWith(stem)) termIndexes.push(index);
    });
  }

  // An anchor that does not contain the finding's own name is already suspect, so any negation in it
  // counts. `без` is included here deliberately: with no term to position it against, the direction
  // rule has nothing to work with and the safer reading wins.
  if (termIndexes.length === 0) {
    return words.some(
      (word) => isSymmetricNegation(word) || PREPOSITIONAL_NEGATION_WORDS.has(word),
    );
  }

  return termIndexes.some((index) => negationGoverns(words, index));
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
  pageImages: string[] = [],
): Promise<StageResult<ExtractResult>> {
  const userPrompt = buildStagePrompt({
    instructions: [
      "Extract clinical entities from the document below.",
      "Report only what this document states. Do not infer, complete, or recall anything from outside it.",
      "For every entity, copy a short verbatim snippet from the document into source_anchor as evidence.",
      "Record labels and units exactly as printed, in the document's own language, in obs_name_text and unit_text.",
      "Set obs_code, finding_code and site_code only when the vocabulary below contains a genuine match; otherwise use null.",
      "A null code is always better than an invented one — codes are resolved downstream and a wrong code is worse than none.",
      "Name findings consistently. When you set a finding_code, copy that vocabulary entry's name into finding_type_text exactly as the vocabulary spells it. When finding_code is null, copy the words the document itself uses for the finding, verbatim.",
      "finding_type_text names the finding only. Put the anatomy in body_site_text — from 'полип желчного пузыря', the finding is 'полип' and the site is 'желчного пузыря'.",
      "A finding is a structural change with a morphology and a place in the body. A qualitative result — a test reported as positive or negative, present or absent, detected or not detected, carrying no measured number — is neither a finding nor an observation. Omit it. A microbiology or serology line such as 'Streptococcus agalactiae (+)' is one of these: it names an organism rather than a structure, it has no site of its own, and filing it against the organ the sample came from also displaces the real finding there.",
      "severity grades the finding, and Russian reports grade in words rather than numbers: 'слабая', 'лёгкая', 'низкой степени', 'минимальная', 'незначительная' mean mild; 'умеренная', 'умеренной степени', 'средней степени' mean moderate; 'выраженная', 'тяжёлая', 'высокой степени', 'резко выраженная' mean severe. Use unknown only when the document does not grade the finding at all.",
      "A condition's name is the diagnosis and nothing else. Do not copy a conclusion sentence into it. The anatomy belongs to the finding that carries it, and the qualifiers — grade, activity, chronicity, cause — belong in their own fields or nowhere. From 'Узловой зоб щитовидной железы с признаками аутоиммунного тиреоидита', the condition name is 'Узловой зоб'.",
      "A sentence that denies a finding is not a finding. 'ЛС не расширена' says the pyelocaliceal system is NOT dilated; 'кишечная метаплазия не выявлена' says metaplasia was NOT found. Never report these in findings — doing so records an abnormality the document explicitly ruled out.",
      "Put those denials in asserted_absences instead, when the document names a specific finding as absent: 'Конкременты: нет', 'дополнительных образований не выявлено', 'без признаков дисплазии'. Give the finding and the site as you would for a finding, and anchor it on the denying sentence. A general statement that an organ looks normal is not an asserted absence — it must name the thing that is missing.",
      "asserted_absences never becomes part of the patient's record. It is read only to check whether something already on the record has since resolved.",
      "If a label is illegible or ambiguous, omit that entity entirely rather than guessing.",
      ...(pageImages.length > 0
        ? [
            // Whatever the transcription failed to express about a table -- which column a number
            // sat under, whether a range belongs to the row above or below -- is unrecoverable
            // from the text alone. The pages settle it.
            "The images accompanying this prompt are the document's own pages, in order.",
            "Read them when the text below is ambiguous about layout: which column a value belongs to, which reference range goes with which analyte, where one table ends and the next begins.",
            "The text remains the record. Copy source_anchor from the text, never from the image, and do not report an entity that appears in neither.",
          ]
        : []),
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
    pageImages,
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
    if (anchorAssertsAbsence(normalized.source_anchor, normalized.finding_type_text ?? "")) {
      rejected.push({
        entityKind: "finding",
        reason: "source anchor states the finding is absent",
      });
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

  const assertedAbsences: AssertedAbsence[] = [];
  for (const item of asArray(result.parsed.asserted_absences)) {
    const obj = asObject(item);
    const findingTypeText = asString(obj.finding_type_text);
    const anchor = asString(obj.source_anchor);
    if (!findingTypeText || !anchor) {
      rejected.push({ entityKind: "absence", reason: "missing finding label or source anchor" });
      continue;
    }
    if (!anchorIsGrounded(anchor, groundingHaystack)) {
      rejected.push({ entityKind: "absence", reason: "source anchor not found in document text" });
      continue;
    }
    // The mirror of the findings guard. An "absence" whose own evidence does not deny anything is
    // a presence that arrived in the wrong array, and letting it through would hand reconciliation
    // grounds to close a finding the document actually reported as still there.
    if (!anchorAssertsAbsence(anchor, findingTypeText)) {
      rejected.push({ entityKind: "absence", reason: "source anchor does not state an absence" });
      continue;
    }
    assertedAbsences.push({
      finding_code: asNullableString(obj.finding_code),
      finding_type_text: findingTypeText,
      site_code: asNullableString(obj.site_code),
      body_site_text: asNullableString(obj.body_site_text),
      source_anchor: anchor,
      confidence: coerceConfidence(obj.confidence),
    });
  }

  // Everything in `rejected` up to this point is an entity that was dropped outright; the loop
  // below then appends the value-level corrections to the same list for the telemetry counts.
  const rejectedEntities = [...rejected];

  // Value-level defects do not drop the entity; they replace one attribute with the column's
  // default and are reported so the review screen can flag them.
  for (const issue of valueIssues) {
    rejected.push({
      entityKind: issue.field,
      reason: `unrecognised value replaced with ${issue.appliedFallback}`,
    });
  }

  // The same corrections, in a shape that survives past the log line: a person reviewing the
  // record has to be able to see what was substituted while the document is still in front of
  // them. `rejected` stays as it is, because the telemetry counts are read off it.
  const issues: ExtractionIssue[] = [
    ...valueIssues.map((issue) => ({
      entityKind: issue.field.split(".")[0],
      field: issue.field,
      received: issue.received,
      resolution: "replaced_with_default" as const,
      appliedFallback: issue.appliedFallback,
      detail: null,
    })),
    ...rejectedEntities.map((rejection) => ({
      entityKind: rejection.entityKind,
      field: null,
      received: null,
      resolution: "dropped" as const,
      appliedFallback: null,
      detail: rejection.reason,
    })),
  ];

  return {
    value: { observations, findings, conditions, asserted_absences: assertedAbsences },
    usage: result.usage,
    finishReason: result.finishReason,
    rejected,
    issues,
  };
}
