import type {
  ConditionToResolve,
  ExistingCondition,
  ExistingFinding,
  ExtractedCondition,
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
export async function processConditionsToResolve(
  recordId: string,
  conditionsToResolve: ConditionToResolve[],
  existingConditions: ExistingCondition[],
  deps: ResolutionDeps,
): Promise<void> {
  for (const toResolve of conditionsToResolve) {
    if (!toResolve.condition_id) continue;
    const existing = existingConditions.find((item) => item.id === toResolve.condition_id);
    if (!existing) continue;
    try {
      await deps.repository.insertConditionRecord({
        condition_id: toResolve.condition_id,
        record_id: recordId,
        status_in_record: "resolved",
        source_anchor: toResolve.source_anchor,
        confidence: toResolve.confidence,
        is_llm_extracted: true,
        is_user_verified: false,
      });
      await deps.repository.recomputeConditionCurrentStatus(toResolve.condition_id);
    } catch (error) {
      deps.log?.error?.("Failed to resolve condition:", error);
    }
  }
}
