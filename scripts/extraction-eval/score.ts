// The import below reaches into supabase/functions, which runs on Deno. It is the production
// finding matcher, deliberately called rather than re-implemented — see `findingResolutionKey`.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../supabase/functions/_shared/deno.d.ts" />
/**
 * Scoring for the extraction eval corpus.
 *
 * Pure by design — plain data in, plain data out, no filesystem and no process. Everything that
 * touches the world lives in run.ts, so this module can be unit-tested directly.
 */
import { matchExistingFinding } from "../../supabase/functions/health-structure/resolution.ts";
import type { ExistingFinding } from "../../supabase/functions/health-structure/types.ts";
import type {
  CaseSnapshot,
  ExpectedCheckup,
  ExpectedFinding,
  ExpectedFindingResolution,
  ExpectedObservation,
  ExpectedResolution,
} from "./types.ts";

const FLOAT_EPSILON = 1e-6;

/**
 * Cyrillic letters that are visually identical to Latin ones. Folded for *matching keys only*.
 *
 * Russian lab reports mix the alphabets constantly — the corpus itself has `Витамин В12` with a
 * Cyrillic В against a catalogue synonym spelled with a Latin b. Without this fold a homoglyph
 * difference reports as a false positive plus a false negative, which reads as "the model invented
 * an analyte and missed another" when it actually found the right one. Field comparison stays
 * strict, so the discrepancy still surfaces — as a field mismatch, which is what it is.
 */
const HOMOGLYPHS: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
  У: "Y",
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  к: "k",
  м: "m",
  т: "t",
};

export function matchKey(value: string | null | undefined): string {
  if (!value) return "";
  return [...value.trim().toLowerCase()]
    .map((char) => HOMOGLYPHS[char] ?? HOMOGLYPHS[char.toUpperCase()]?.toLowerCase() ?? char)
    .join("")
    .replace(/[\s ]+/g, " ")
    .replace(/[.,;:]+$/g, "");
}

export function valuesEqual(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (actual === null || actual === undefined) return false;
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(expected - actual) <= FLOAT_EPSILON;
  }
  if (typeof expected === "number" || typeof actual === "number") {
    const a = Number(expected);
    const b = Number(actual);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= FLOAT_EPSILON;
  }
  return String(expected) === String(actual);
}

export interface SetScore {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  /** Present in the output but not expected — the dangerous direction for resolutions. */
  falsePositives: string[];
  /** Expected but absent from the output. */
  falseNegatives: string[];
}

export interface FieldMismatch {
  key: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface FieldAccuracy {
  field: string;
  correct: number;
  total: number;
  accuracy: number;
  mismatches: FieldMismatch[];
}

export interface ScalarScore {
  expected: unknown;
  actual: unknown;
  correct: boolean;
}

export interface CaseScore {
  caseId: string;
  recordType: ScalarScore;
  recordDate: ScalarScore;
  observations: SetScore;
  observationFields: FieldAccuracy[];
  findings: SetScore;
  findingFields: FieldAccuracy[];
  conditions: SetScore;
  findingsToResolve: SetScore;
  conditionsToResolve: SetScore;
  checkupsToComplete: SetScore;
  checkupDate: FieldAccuracy;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

/**
 * Matched on `key`, reported as `label`.
 *
 * Keeping the two apart matters: the key is homoglyph-folded and lowercased, which makes it a good
 * comparison token and terrible reading. A report that says a model invented `фeppиtиh` sends a
 * reviewer hunting for a transliteration bug that does not exist.
 */
export interface KeyedItem {
  key: string;
  label: string;
}

export function keyed(label: string | null | undefined): KeyedItem {
  return { key: matchKey(label), label: (label ?? "").trim() };
}

export function scoreSet(expected: KeyedItem[], actual: KeyedItem[]): SetScore {
  const remaining = [...actual];
  const falseNegatives: string[] = [];
  let tp = 0;
  for (const item of expected) {
    const at = remaining.findIndex((candidate) => candidate.key === item.key);
    if (at === -1) {
      falseNegatives.push(item.label);
    } else {
      remaining.splice(at, 1);
      tp += 1;
    }
  }
  const fp = remaining.length;
  const fn = falseNegatives.length;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    falsePositives: remaining.map((item) => item.label),
    falseNegatives,
  };
}

const OBSERVATION_FIELDS: (keyof ExpectedObservation)[] = [
  "obs_code",
  "is_applied",
  "value_numeric",
  "unit",
  "ref_range_low",
  "ref_range_high",
  "status",
  "value_canonical",
  "unit_canonical",
];

/**
 * A finding's scored fields.
 *
 * `finding_type_text` is absent on purpose: it is the match key, so comparing it here would score
 * every matched row as correct by construction. Everything else on the row is the part the
 * deterministic half of the pipeline produces — code and site resolution, laterality, size — and
 * until this existed, none of it was compared to anything. Case 002 wrote `kidney_right`,
 * `bilateral` and `size_mm` into `expected.json` and the scorer read none of them.
 */
const FINDING_FIELDS: (keyof ExpectedFinding)[] = [
  "finding_code",
  "site_code",
  "body_site_text",
  "size_mm",
  "severity",
  "laterality",
];

/**
 * Per-field accuracy over the rows both sides agree exist.
 *
 * Only matched rows are scored. A row the model never produced is already counted as a recall
 * miss; charging it again on every field would let one missed row swamp the field accuracies.
 */
function scoreFields<T>(
  expected: T[],
  actual: T[],
  keyOf: (row: T) => string,
  labelOf: (row: T) => string,
  fields: (keyof T)[],
): FieldAccuracy[] {
  const byKey = new Map(actual.map((row) => [keyOf(row), row]));
  return fields.map((field) => {
    const mismatches: FieldMismatch[] = [];
    let correct = 0;
    let total = 0;
    for (const row of expected) {
      const other = byKey.get(keyOf(row));
      if (!other) continue;
      total += 1;
      if (valuesEqual(row[field], other[field])) {
        correct += 1;
      } else {
        mismatches.push({
          key: labelOf(row),
          field: String(field),
          expected: row[field],
          actual: other[field],
        });
      }
    }
    return { field: String(field), correct, total, accuracy: ratio(correct, total), mismatches };
  });
}

function checkupKey(item: ExpectedCheckup): KeyedItem {
  return { key: item.checkup_item_id, label: item.checkup_item_id };
}

function resolutionKey(item: ExpectedResolution): KeyedItem {
  return { key: item.condition_id, label: item.condition_id };
}

/**
 * Finding resolutions have no id, so they are keyed by the row they would actually close.
 *
 * Not by how they are worded. Production resolves a finding by `finding_code` + `site_code`, then
 * by `finding_code` alone, and only falls back to comparing type text and body-site text
 * (`resolution.ts:matchExistingFinding`). Scoring on the text instead inverts the result in both
 * directions: a wrong code carrying copied text scores as a hit while production closes a
 * different row or nothing, and a right code phrased differently scores as a miss *and* an
 * invention while production closes exactly the intended row.
 *
 * Re-deriving that precedence here would also be wrong, because expected and actual can land in
 * different tiers — a coded resolution and an uncoded one that both close the same row would key
 * differently. Calling the production matcher and keying on its answer is the only version that
 * cannot drift.
 *
 * A resolution matching nothing keys on its own text, kept distinct from row keys, so several
 * unmatched entries stay separable and still count as inventions.
 */
function findingResolutionKey(
  item: ExpectedFindingResolution,
  existingFindings: ExistingFinding[],
): KeyedItem {
  const matched = matchExistingFinding(
    {
      finding_code: item.finding_code ?? null,
      site_code: item.site_code ?? null,
      finding_type_text: item.finding_type_text ?? "",
      body_site_text: item.body_site_text ?? null,
    },
    existingFindings,
  );
  if (matched) {
    const site = matched.site_code ?? matchKey(matched.body_site_text);
    return {
      key: `row:${matched.finding_code ?? matchKey(matched.finding_type_text)}@${site}`,
      label: `${matched.finding_type_text}${site ? ` @ ${site}` : ""}`,
    };
  }
  const site = item.site_code ?? matchKey(item.body_site_text) ?? "";
  return {
    key: `unmatched:${matchKey(item.finding_type_text)}@${site}`,
    label: `${(item.finding_type_text ?? "").trim()}${site ? ` @ ${site}` : ""} (closes nothing)`,
  };
}

/**
 * `existingFindings` is the case's patient state, required rather than optional: without it every
 * finding resolution keys as "closes nothing" and the dimension silently reports garbage — the
 * exact failure mode that let `findings_to_resolve` go unscored in the first place.
 */
export function scoreCase(
  caseId: string,
  expected: CaseSnapshot,
  actual: CaseSnapshot,
  existingFindings: ExistingFinding[],
): CaseScore {
  const checkupDateMismatches: FieldMismatch[] = [];
  let checkupDateCorrect = 0;
  let checkupDateTotal = 0;
  const actualCheckups = new Map(actual.checkups_to_complete.map((c) => [c.checkup_item_id, c]));
  for (const item of expected.checkups_to_complete) {
    const other = actualCheckups.get(item.checkup_item_id);
    if (!other) continue;
    checkupDateTotal += 1;
    if (valuesEqual(item.suggested_done_at, other.suggested_done_at)) {
      checkupDateCorrect += 1;
    } else {
      checkupDateMismatches.push({
        key: item.checkup_item_id,
        field: "suggested_done_at",
        expected: item.suggested_done_at,
        actual: other.suggested_done_at,
      });
    }
  }

  return {
    caseId,
    recordType: {
      expected: expected.record_type,
      actual: actual.record_type,
      correct: valuesEqual(expected.record_type, actual.record_type),
    },
    recordDate: {
      expected: expected.record_date,
      actual: actual.record_date,
      correct: valuesEqual(expected.record_date, actual.record_date),
    },
    observations: scoreSet(
      expected.observations.map((o) => keyed(o.obs_name)),
      actual.observations.map((o) => keyed(o.obs_name)),
    ),
    observationFields: scoreFields(
      expected.observations,
      actual.observations,
      (row) => matchKey(row.obs_name),
      (row) => row.obs_name,
      OBSERVATION_FIELDS,
    ),
    findings: scoreSet(
      expected.findings.map((f) => keyed(f.finding_type_text)),
      actual.findings.map((f) => keyed(f.finding_type_text)),
    ),
    findingFields: scoreFields(
      expected.findings,
      actual.findings,
      (row) => matchKey(row.finding_type_text),
      (row) => row.finding_type_text,
      FINDING_FIELDS,
    ),
    conditions: scoreSet(
      expected.conditions.map((c) => keyed(c.name)),
      actual.conditions.map((c) => keyed(c.name)),
    ),
    findingsToResolve: scoreSet(
      expected.findings_to_resolve.map((item) => findingResolutionKey(item, existingFindings)),
      actual.findings_to_resolve.map((item) => findingResolutionKey(item, existingFindings)),
    ),
    // Ids are opaque and already exact — no folding, and the label is the id itself.
    conditionsToResolve: scoreSet(
      expected.conditions_to_resolve.map(resolutionKey),
      actual.conditions_to_resolve.map(resolutionKey),
    ),
    checkupsToComplete: scoreSet(
      expected.checkups_to_complete.map(checkupKey),
      actual.checkups_to_complete.map(checkupKey),
    ),
    checkupDate: {
      field: "suggested_done_at",
      correct: checkupDateCorrect,
      total: checkupDateTotal,
      accuracy: ratio(checkupDateCorrect, checkupDateTotal),
      mismatches: checkupDateMismatches,
    },
  };
}

export interface Aggregate {
  cases: number;
  recordTypeAccuracy: number;
  recordDateAccuracy: number;
  observations: SetScore;
  findings: SetScore;
  conditions: SetScore;
  findingsToResolve: SetScore;
  conditionsToResolve: SetScore;
  checkupsToComplete: SetScore;
  observationFields: FieldAccuracy[];
  findingFields: FieldAccuracy[];
  /**
   * Wrongful closures across the whole run — findings and conditions both. The number to look at
   * first. A wrongfully closed finding is the same class of harm as a wrongfully closed condition:
   * a live row in someone's chart goes quiet with nothing to prompt a correction.
   */
  wrongfulResolutions: number;
}

function sumSets(scores: SetScore[]): SetScore {
  const tp = scores.reduce((n, s) => n + s.tp, 0);
  const fp = scores.reduce((n, s) => n + s.fp, 0);
  const fn = scores.reduce((n, s) => n + s.fn, 0);
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    falsePositives: scores.flatMap((s) => s.falsePositives),
    falseNegatives: scores.flatMap((s) => s.falseNegatives),
  };
}

function sumFields(
  scores: CaseScore[],
  pick: (score: CaseScore) => FieldAccuracy[],
  fields: string[],
): FieldAccuracy[] {
  return fields.map((field) => {
    const per = scores.flatMap((s) => pick(s).filter((f) => f.field === field));
    const correct = per.reduce((n, f) => n + f.correct, 0);
    const total = per.reduce((n, f) => n + f.total, 0);
    return {
      field,
      correct,
      total,
      accuracy: ratio(correct, total),
      mismatches: per.flatMap((f) => f.mismatches),
    };
  });
}

export function aggregate(scores: CaseScore[]): Aggregate {
  const fields = sumFields(scores, (s) => s.observationFields, OBSERVATION_FIELDS.map(String));
  const conditionsToResolve = sumSets(scores.map((s) => s.conditionsToResolve));
  const findingsToResolve = sumSets(scores.map((s) => s.findingsToResolve));
  return {
    cases: scores.length,
    recordTypeAccuracy: ratio(scores.filter((s) => s.recordType.correct).length, scores.length),
    recordDateAccuracy: ratio(scores.filter((s) => s.recordDate.correct).length, scores.length),
    observations: sumSets(scores.map((s) => s.observations)),
    findings: sumSets(scores.map((s) => s.findings)),
    conditions: sumSets(scores.map((s) => s.conditions)),
    findingsToResolve,
    conditionsToResolve,
    checkupsToComplete: sumSets(scores.map((s) => s.checkupsToComplete)),
    observationFields: fields,
    findingFields: sumFields(scores, (s) => s.findingFields, FINDING_FIELDS.map(String)),
    wrongfulResolutions: conditionsToResolve.fp + findingsToResolve.fp,
  };
}
