import { foldForMatch } from "./code-resolution.ts";
import type { StageRejection } from "./stages/types.ts";
import type {
  ConditionToResolve,
  ExistingCondition,
  ExistingFinding,
  ExtractedCondition,
  ExtractedObservation,
  FindingToResolve,
} from "./types.ts";
export interface ResolutionRepository {
  insertConditionRecord(payload: Record<string, unknown>): Promise<void>;
  recomputeConditionCurrentStatus(conditionId: string): Promise<void>;
  insertFinding(payload: Record<string, unknown>): Promise<void>;
}
export interface ResolutionDeps {
  repository: ResolutionRepository;
  log?: Pick<Console, "log" | "warn" | "error">;
}
function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
/**
 * Record what the document said about conditions, without changing the patient's chart.
 *
 * Extraction used to create `conditions` rows itself, so a model's reading landed in the chart
 * before anyone had reviewed the record -- and a mention deleted at review left the condition
 * behind. A mention the model found is now a proposal scoped to this record. It becomes a real
 * condition only on the activation path, when a person approves the record.
 *
 * The one exception is a condition the model matched to a row that already exists: there is
 * nothing to propose, so the mention links to it directly. It still carries
 * `is_user_verified: false`, so review sees it.
 */
export async function processExtractedConditions(
  recordId: string,
  _personId: string,
  conditions: ExtractedCondition[],
  deps: ResolutionDeps,
): Promise<void> {
  for (const extracted of conditions) {
    try {
      const existingId = extracted.existing_condition_id;
      const proposedName = normalizeText(extracted.name);
      if (!existingId && !proposedName) {
        deps.log?.warn?.("Skipping condition without identifier or name");
        continue;
      }
      await deps.repository.insertConditionRecord({
        condition_id: existingId,
        proposed_name: existingId ? null : proposedName,
        proposed_icd_code: existingId ? null : (normalizeText(extracted.icd_code) ?? null),
        record_id: recordId,
        status_in_record: extracted.status,
        source_anchor: extracted.source_anchor,
        confidence: extracted.confidence,
        is_llm_extracted: true,
        is_user_verified: false,
      });
      // Only a mention of a condition that already exists can move that condition's status; a
      // proposal has no condition to recompute yet.
      if (existingId) await deps.repository.recomputeConditionCurrentStatus(existingId);
    } catch (error) {
      deps.log?.error?.("Failed to process extracted condition:", error);
    }
  }
}
/**
 * Which existing finding a resolution addresses, by code first and text last.
 *
 * Exported for the extraction eval, which has to score resolutions by the row they would actually
 * close rather than by how they are worded. Anything that re-derives this precedence instead of
 * calling it will disagree with production the moment the two drift.
 *
 * The parameter is the subset actually read, not the full `FindingToResolve`: a caller scoring a
 * fixture has no `reason`, `source_anchor` or `confidence` to offer, and requiring them would mean
 * inventing values that this function ignores.
 */
export function matchExistingFinding(
  toResolve: Pick<
    FindingToResolve,
    "finding_code" | "site_code" | "finding_type_text" | "body_site_text"
  >,
  existingFindings: ExistingFinding[],
): ExistingFinding | null {
  for (const finding of existingFindings) {
    if (toResolve.finding_code && toResolve.site_code) {
      if (
        finding.finding_code === toResolve.finding_code &&
        finding.site_code === toResolve.site_code
      ) {
        return finding;
      }
      continue;
    }
    if (toResolve.finding_code) {
      if (finding.finding_code === toResolve.finding_code) return finding;
      continue;
    }
    const findingTextMatch =
      finding.finding_type_text.toLowerCase().trim() ===
      toResolve.finding_type_text.toLowerCase().trim();
    const siteTextMatch =
      !toResolve.body_site_text ||
      finding.body_site_text?.toLowerCase().trim() ===
        toResolve.body_site_text.toLowerCase().trim();
    if (findingTextMatch && siteTextMatch) return finding;
  }
  return null;
}
export async function processFindingsToResolve(
  recordId: string,
  personId: string,
  recordDate: string | null,
  findingsToResolve: FindingToResolve[],
  existingFindings: ExistingFinding[],
  deps: ResolutionDeps,
): Promise<void> {
  for (const toResolve of findingsToResolve) {
    const matching = matchExistingFinding(toResolve, existingFindings);
    if (!matching) {
      deps.log?.warn?.("Could not match finding to resolve:", toResolve.finding_type_text);
      continue;
    }
    try {
      await deps.repository.insertFinding({
        person_id: personId,
        record_id: recordId,
        finding_type_id: matching.finding_type_id,
        finding_code: matching.finding_code,
        finding_type_text: matching.finding_type_text,
        body_site_id: matching.body_site_id,
        site_code: matching.site_code,
        body_site_text: matching.body_site_text,
        // The row records a resolution, not a measurement: no size, no count, and the status
        // says so explicitly. Zeros here used to mean "resolved", which made a real measured
        // zero vanish from the active list.
        size_mm: null,
        count: null,
        resolution_status: "resolved",
        severity: "unknown",
        laterality: "none",
        finding_date: recordDate,
        source_anchor: toResolve.source_anchor || `Resolved: ${toResolve.reason}`,
        is_llm_extracted: true,
        is_user_verified: false,
        confidence: toResolve.confidence,
      });
    } catch (error) {
      deps.log?.error?.("Failed to insert finding resolution row:", error);
    }
  }
}
/**
 * One analyte that can close a condition, and what it takes.
 *
 * `requires` names every observation code that must be present in *this* document and in range;
 * an entry needing two measurements is not satisfied by one of them. `icdPrefixes` and
 * `namePatterns` are the condition matcher: the condition being closed must satisfy at least one
 * of the two, and both lists exist because `conditions.code` is nullable and routinely null —
 * ICD is the strong signal where it exists, the name pattern is what remains where it does not.
 *
 * `confident` is a claim about clinical certainty, and it is written by a non-clinician. It means
 * only that the entry could ever be promoted to closing a condition without a person; nothing
 * reads it yet, because today every entry proposes and a person confirms.
 *
 * ## How an entry earns auto-close
 *
 * An entry marked `confident: false` may only ever propose. That is not a temporary state waiting
 * for someone to feel better about it: promoting an entry takes evidence out of the database, and
 * the evidence is what people did with the proposals it produced. Read it with the query in the
 * T-0026 ExecPlan, which counts `condition_records.review_decision` per `supporting_obs_code`:
 *
 *     select supporting_obs_code,
 *            count(*) filter (where review_decision = 'confirmed') as confirmed,
 *            count(*) filter (where review_decision = 'dismissed') as dismissed,
 *            count(*) filter (where review_decision = 'pending')   as pending
 *     from public.condition_records
 *     where supporting_obs_code is not null
 *     group by supporting_obs_code
 *     order by confirmed desc;
 *
 * The threshold: **twenty confirmations and zero dismissals** for that analyte. Twenty because a
 * handful of confirmations is one person's habit rather than evidence, and because the harm is
 * asymmetric — a proposal that should have auto-closed costs a click, while an auto-close that
 * should not have happened ends a live entry in someone's chart with nothing to prompt a second
 * look. Zero and not "few" for the same reason: a dismissal is a person saying this closure was
 * wrong, and one such person is enough to say the entry is not ready to act alone.
 *
 * `pending` is not evidence and must never be added to `confirmed`. A proposal nobody has ruled on
 * says nothing about whether the rule is right; counting the two together — which is all a boolean
 * `is_user_verified` could ever have offered — would let an entry nobody has looked at read as an
 * entry nobody objected to. That is why Milestone 2 made the column three-valued.
 *
 * Any dismissal after promotion returns the entry to `confident: false` and is worth investigating
 * rather than filing: it means the rule closed something a person could see should stay open.
 */
export interface ResolvingAnalyte {
  requires: string[];
  icdPrefixes: string[];
  namePatterns: string[];
  confident: boolean;
}

/**
 * Which analytes returning to their reference range close which conditions.
 *
 * Keyed on the observation catalogue — thirty-eight entries the team owns — rather than on ICD,
 * which is nullable on conditions, unbounded in size and inconsistently formatted. It lives in
 * code rather than in a table because it is policy about when the system may write to someone's
 * medical record, and the reference catalogues are world-readable, one of them world-writable.
 *
 * The set is small on purpose. A deficiency named after a substance ends when that substance is
 * measured back in range; almost nothing else about a chronic condition is settled by one number.
 *
 * **Before adding an entry, read the exclusions below.** Three of them are the corpus's own traps,
 * and each is a condition that an in-range value looks like it should close and must not.
 */
export const RESOLVING_ANALYTES: Record<string, ResolvingAnalyte> = {
  // A B12 deficiency is the statement that B12 is low. A normal level ends it.
  //
  // `E53.8` and not `E53`: the parent covers `E53.0` riboflavin and `E53.1` pyridoxine, which are
  // different vitamins entirely, and a prefix that reaches them would let an in-range B12 close a
  // deficiency nothing in this document measured. Every prefix below is chosen the same way —
  // narrow enough that everything under it is the condition the analyte speaks to. `E55` is
  // vitamin D throughout (`E55.0` rickets, `E55.9` unspecified), `D50` is iron-deficiency anaemia
  // throughout, and `E61.1` is iron deficiency itself.
  vitamin_b12: {
    requires: ["vitamin_b12"],
    icdPrefixes: ["E53.8"],
    namePatterns: ["b12", "в12", "кобаламин"],
    confident: true,
  },
  // Same shape: the deficiency is defined by the measurement.
  vitamin_d_25oh: {
    requires: ["vitamin_d_25oh"],
    icdPrefixes: ["E55"],
    namePatterns: ["витамин d", "витамин д", "25-oh"],
    confident: true,
  },
  // Iron-deficiency anaemia needs both. Haemoglobin is what makes it anaemia and ferritin is what
  // makes it iron deficiency; either alone leaves half the diagnosis unaddressed. Marked uncertain
  // because replete iron stores under active supplementation read as resolution when they are
  // maintenance.
  ferritin: {
    requires: ["ferritin", "hemoglobin"],
    icdPrefixes: ["D50", "E61.1"],
    namePatterns: ["железодефицит", "жда", "iron deficiency"],
    confident: false,
  },

  // Deliberately excluded, and each exclusion is the whole point of the table being curated.
  // Adding any of these is a clinical decision and needs a clinician, not a reviewer who noticed
  // the value was in range:
  //
  //   tsh            — treated hypothyroidism has a normal TSH precisely because it is treated.
  //   glucose, hba1c — controlled diabetes is not resolved diabetes.
  //   lipids         — an in-range panel under management is control rather than cure, so it does
  //                    not close dyslipidaemia.
  //   alt, ast, ggt  — non-alcoholic fatty liver disease is an imaging and histology diagnosis;
  //                    normal enzymes cannot exclude steatosis.
  //   anything       — for chronic gastritis, which is endoscopic. Nothing in a biochemistry panel
  //                    bears on it.
};

/**
 * Why a cited resolution was refused. Fixed strings: these reach logs, so they name the check
 * that failed and never the entity that failed it.
 */
export const LAB_RESOLUTION_REJECTIONS = {
  noCitation: "no supporting observation cited",
  analyteCannotResolve: "analyte cannot resolve a condition",
  analyteConditionMismatch: "analyte does not match this condition",
  observationAbsent: "required observation absent from this document",
  observationOutOfRange: "supporting observation is not in range",
} as const;

/** Upper-case and strip everything but letters and digits: `D50.9`, `d50.9` and `D509` are one code. */
function normalizeIcd(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function conditionMatchesAnalyte(condition: ExistingCondition, entry: ResolvingAnalyte): boolean {
  const code = condition.code ? normalizeIcd(condition.code) : "";
  if (code && entry.icdPrefixes.some((prefix) => code.startsWith(normalizeIcd(prefix)))) {
    return true;
  }
  const name = foldForMatch(condition.name ?? "");
  if (!name) return false;
  return entry.namePatterns.some((pattern) => {
    const folded = foldForMatch(pattern);
    return folded.length > 0 && name.includes(folded);
  });
}

/**
 * Is this value inside the range the document printed for it?
 *
 * Numeric when the document printed a range, because a printed range is the document's own
 * statement about this value and needs no interpretation. The extracted `status` is the fallback
 * only when no range was printed, and only the exact value `normal` passes: `unknown` and null
 * are not evidence of anything. A missing or unparseable number is treated as out of range rather
 * than as passing — the whole gate exists so that an unchecked claim cannot close a condition.
 */
export function isObservationInRange(observation: ExtractedObservation): boolean {
  const low = observation.ref_range_low;
  const high = observation.ref_range_high;
  const hasLow = typeof low === "number" && Number.isFinite(low);
  const hasHigh = typeof high === "number" && Number.isFinite(high);
  if (hasLow || hasHigh) {
    const value = observation.value_numeric;
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (hasLow && value < (low as number)) return false;
    if (hasHigh && value > (high as number)) return false;
    return true;
  }
  return observation.status === "normal";
}

/**
 * Decide whether a proposed lab-driven resolution may be written, and say why not when it may not.
 *
 * Four checks, and the third is the one that makes the other three mean anything. Without it a
 * model citing `vitamin_b12` — cited, permitted, present and in range — closes dyslipidaemia,
 * because nothing has asked whether that analyte has anything to do with that condition. The gate
 * would then accept the exact wrongful proposal it exists to reject.
 *
 * This is a floor, not the discriminator. It rejects a resolution that cites nothing, cites an
 * analyte no entry covers, cites one unrelated to the condition, or cites one absent or out of
 * range. It cannot tell a well-formed wrong entry from a right one — that is what marking an entry
 * uncertain, proposing rather than closing, and a person confirming are for.
 *
 * Returns null when the resolution passes, or one of `LAB_RESOLUTION_REJECTIONS` when it does not.
 */
export function checkLabResolution(
  toResolve: Pick<ConditionToResolve, "supporting_obs_code">,
  condition: ExistingCondition,
  observations: ExtractedObservation[],
): string | null {
  const cited = normalizeText(toResolve.supporting_obs_code);
  if (!cited) return LAB_RESOLUTION_REJECTIONS.noCitation;

  const entry = RESOLVING_ANALYTES[cited];
  if (!entry) return LAB_RESOLUTION_REJECTIONS.analyteCannotResolve;

  if (!conditionMatchesAnalyte(condition, entry)) {
    return LAB_RESOLUTION_REJECTIONS.analyteConditionMismatch;
  }

  for (const required of entry.requires) {
    const matching = observations.filter((item) => item.obs_code === required);
    if (matching.length === 0) return LAB_RESOLUTION_REJECTIONS.observationAbsent;
    // Every row carrying this code, not merely one of them: a panel that printed the analyte twice
    // with disagreeing values has not established that it is in range.
    if (!matching.every(isObservationInRange)) {
      return LAB_RESOLUTION_REJECTIONS.observationOutOfRange;
    }
  }

  return null;
}

/**
 * The anchor to persist for a lab-driven resolution: the cited observation's own, never the
 * model's.
 *
 * The reconcile prompt tells the model to copy the observation's anchor verbatim and never to
 * assemble one out of a code and a value. That instruction is worth having and it is not worth
 * trusting. `source_anchor` is shown to a person as a quotation from their own document while they
 * decide whether to end an entry in their medical record, and a fabricated one is indistinguishable
 * from a real one by reading it — which is exactly the case for deciding it here rather than asking
 * the model nicely. Every other check in this file runs after the model for the same reason.
 *
 * Derived from the code the resolution cites, which `checkLabResolution` has already established is
 * present, in range and permitted for this condition. The model's string is used only when the
 * observation carries no anchor at all, which is the pre-staged parser's output: older records
 * should keep whatever evidence they had rather than lose it to a stricter rule.
 */
function resolutionAnchor(
  toResolve: ConditionToResolve,
  observations: ExtractedObservation[],
): string {
  const cited = normalizeText(toResolve.supporting_obs_code);
  if (!cited) return toResolve.source_anchor;

  const anchored = observations.find(
    (item) => item.obs_code === cited && normalizeText(item.source_anchor),
  );
  return normalizeText(anchored?.source_anchor) ?? toResolve.source_anchor;
}

/**
 * Record the resolutions this document supports, as proposals a person still has to confirm.
 *
 * Every resolution passes `checkLabResolution` first, against the observations extracted from
 * *this* document. One that fails is dropped rather than written, and the drop is returned as a
 * rejection naming the check — the model does not get to talk past a check that runs after it.
 *
 * The row is written with `review_decision: "pending"` and `is_user_verified: false`, which after
 * Milestone 1 means it is recorded and visible but cannot move `conditions.current_status`. The
 * recompute still runs, because it is what applies a *verified* row that this insert may have
 * reordered; it is not what applies this one.
 */
export async function processConditionsToResolve(
  recordId: string,
  conditionsToResolve: ConditionToResolve[],
  existingConditions: ExistingCondition[],
  observations: ExtractedObservation[],
  deps: ResolutionDeps,
): Promise<StageRejection[]> {
  const rejected: StageRejection[] = [];
  for (const toResolve of conditionsToResolve) {
    if (!toResolve.condition_id) continue;
    const existing = existingConditions.find((item) => item.id === toResolve.condition_id);
    if (!existing) continue;

    const rejection = checkLabResolution(toResolve, existing, observations);
    if (rejection) {
      rejected.push({ entityKind: "condition_to_resolve", reason: rejection });
      deps.log?.warn?.("Dropped condition resolution:", rejection);
      continue;
    }

    try {
      await deps.repository.insertConditionRecord({
        condition_id: toResolve.condition_id,
        record_id: recordId,
        status_in_record: "resolved",
        source_anchor: resolutionAnchor(toResolve, observations),
        confidence: toResolve.confidence,
        supporting_obs_code: normalizeText(toResolve.supporting_obs_code),
        review_decision: "pending",
        is_llm_extracted: true,
        is_user_verified: false,
      });
      await deps.repository.recomputeConditionCurrentStatus(toResolve.condition_id);
    } catch (error) {
      deps.log?.error?.("Failed to resolve condition:", error);
    }
  }
  return rejected;
}
