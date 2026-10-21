import {
  asArray,
  asNullableString,
  asNumber,
  asObject,
  asString,
  isTextGrounded,
  normalizeForGrounding,
} from "./normalize.ts";
import type { AssertedAbsence, ExtractResult, StageRejection } from "./types.ts";
import type {
  ExtractedCondition,
  ExtractedFinding,
  ExtractedObservation,
  ExtractionIssue,
} from "../types.ts";
import {
  coerceConfidence,
  coerceEnum,
  coerceIsoDate,
  coerceNullableEnum,
  CONDITION_STATUSES,
  LATERALITIES,
  OBSERVATION_STATUSES,
  SEVERITIES,
  type ValueIssue,
} from "./validate.ts";

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
    if (PREPOSITIONAL_NEGATION_WORDS.has(word) && index < termIndex) {
      return true;
    }
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
 * The deterministic half of the extract stage: everything that happens to an extraction after it
 * exists, whoever produced it.
 *
 * `parsed` is an object in the `EXTRACT_SCHEMA` shape — the model's answer in `runExtractStage`, or
 * an extraction an MCP client submitted. `documentText` is the text the anchors must be found in.
 * Entities are normalised, an entity whose `source_anchor` is not in the text is dropped, a finding
 * whose own anchor denies it is dropped, and an absence whose anchor denies nothing is refused.
 * Nothing here calls a model, so both paths go through exactly the same checks.
 */
export function normalizeExtraction(
  parsed: Record<string, unknown>,
  documentText: string,
): {
  value: ExtractResult;
  rejected: StageRejection[];
  issues: ExtractionIssue[];
} {
  const rejected: StageRejection[] = [];
  const valueIssues: ValueIssue[] = [];
  const groundingHaystack = normalizeForGrounding(documentText);

  /**
   * Corrections belong to the entity they were made on, not to the document.
   *
   * A shared list cannot tell the two apart: a finding whose severity was coerced and which is
   * then dropped for an ungrounded anchor would be reported as both "severity saved as unknown"
   * and "finding not saved", which contradicts itself. So each entity collects its own, and they
   * are kept only if the entity survives to be written.
   */
  const issues: ExtractionIssue[] = [];

  const dropped = (entityKind: string, entityLabel: string | null, reason: string) => {
    rejected.push({ entityKind, reason });
    issues.push({
      entityKind,
      entityLabel,
      field: null,
      received: null,
      resolution: "dropped",
      appliedFallback: null,
      detail: reason,
    });
  };

  const kept = (entityKind: string, entityLabel: string | null, entityIssues: ValueIssue[]) => {
    for (const issue of entityIssues) {
      valueIssues.push(issue);
      issues.push({
        entityKind,
        // Which row to look at: on a panel of forty analytes, "observation.status" alone does
        // not tell a reviewer which value to correct.
        entityLabel,
        field: issue.field,
        received: issue.received,
        resolution: "replaced_with_default",
        appliedFallback: issue.appliedFallback,
        detail: null,
      });
    }
  };

  const observations: ExtractedObservation[] = [];
  for (const item of asArray(parsed.observations)) {
    const itemIssues: ValueIssue[] = [];
    const normalized = normalizeObservation(item, itemIssues);
    if (!normalized) {
      dropped("observation", null, "missing analyte label");
      continue;
    }
    if (!anchorIsGrounded(normalized.source_anchor, groundingHaystack)) {
      dropped("observation", normalized.obs_name, "source anchor not found in document text");
      continue;
    }
    observations.push(normalized);
    kept("observation", normalized.obs_name, itemIssues);
  }

  const findings: ExtractedFinding[] = [];
  for (const item of asArray(parsed.findings)) {
    const itemIssues: ValueIssue[] = [];
    const normalized = normalizeFinding(item, itemIssues);
    if (!normalized) {
      dropped("finding", null, "missing finding label or source anchor");
      continue;
    }
    if (!anchorIsGrounded(normalized.source_anchor, groundingHaystack)) {
      dropped("finding", normalized.finding_type_text, "source anchor not found in document text");
      continue;
    }
    if (anchorAssertsAbsence(normalized.source_anchor, normalized.finding_type_text ?? "")) {
      dropped(
        "finding",
        normalized.finding_type_text,
        "source anchor states the finding is absent",
      );
      continue;
    }
    findings.push(normalized);
    kept("finding", normalized.finding_type_text, itemIssues);
  }

  const conditions: ExtractedCondition[] = [];
  for (const item of asArray(parsed.conditions)) {
    const itemIssues: ValueIssue[] = [];
    const normalized = normalizeCondition(item, itemIssues);
    if (!normalized) {
      dropped("condition", null, "missing condition name");
      continue;
    }
    if (!anchorIsGrounded(normalized.source_anchor, groundingHaystack)) {
      dropped("condition", normalized.name, "source anchor not found in document text");
      continue;
    }
    conditions.push(normalized);
    kept("condition", normalized.name, itemIssues);
  }

  const assertedAbsences: AssertedAbsence[] = [];
  for (const item of asArray(parsed.asserted_absences)) {
    const obj = asObject(item);
    const findingTypeText = asString(obj.finding_type_text);
    const anchor = asString(obj.source_anchor);
    if (!findingTypeText || !anchor) {
      rejected.push({
        entityKind: "absence",
        reason: "missing finding label or source anchor",
      });
      continue;
    }
    if (!anchorIsGrounded(anchor, groundingHaystack)) {
      rejected.push({
        entityKind: "absence",
        reason: "source anchor not found in document text",
      });
      continue;
    }
    // The mirror of the findings guard. An "absence" whose own evidence does not deny anything is
    // a presence that arrived in the wrong array, and letting it through would hand reconciliation
    // grounds to close a finding the document actually reported as still there.
    if (!anchorAssertsAbsence(anchor, findingTypeText)) {
      rejected.push({
        entityKind: "absence",
        reason: "source anchor does not state an absence",
      });
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

  // Value-level defects do not drop the entity; they replace one attribute with the column's
  // default. Appended to `rejected` for the telemetry counts, which are read off it.
  for (const issue of valueIssues) {
    rejected.push({
      entityKind: issue.field,
      reason: `unrecognised value replaced with ${issue.appliedFallback}`,
    });
  }

  return {
    value: {
      observations,
      findings,
      conditions,
      asserted_absences: assertedAbsences,
    },
    rejected,
    issues,
  };
}
