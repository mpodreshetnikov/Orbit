import type {
  ConditionToResolve,
  ExistingCondition,
  ExistingFinding,
  ExtractedCondition,
  FindingToResolve,
  IcdLookupResult,
} from "./types.ts";

export interface ResolutionRepository {
  findConditionByIcd(personId: string, code: string): Promise<{ id: string } | null>;
  findConditionByName(personId: string, name: string): Promise<{ id: string } | null>;
  createCondition(payload: Record<string, unknown>): Promise<{ id: string } | null>;
  updateCondition(conditionId: string, patch: Record<string, unknown>): Promise<void>;
  insertConditionRecord(payload: Record<string, unknown>): Promise<void>;
  recomputeConditionCurrentStatus(conditionId: string): Promise<void>;
  insertFinding(payload: Record<string, unknown>): Promise<void>;
}

export interface ResolutionDeps {
  repository: ResolutionRepository;
  lookupIcdCode: (code: string) => Promise<IcdLookupResult | null>;
  log?: Pick<Console, "log" | "warn" | "error">;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveOrCreateCondition(
  extracted: ExtractedCondition,
  personId: string,
  deps: ResolutionDeps,
): Promise<string | null> {
  let icdLookupResult: IcdLookupResult | null = null;
  if (extracted.icd_code) {
    icdLookupResult = await deps.lookupIcdCode(extracted.icd_code);
  }

  if (extracted.existing_condition_id) {
    if (extracted.icd_code && icdLookupResult?.found) {
      await deps.repository.updateCondition(extracted.existing_condition_id, {
        code: extracted.icd_code,
        icd_name_en: icdLookupResult.name_en,
        icd_name_ru: icdLookupResult.name_ru,
      });
    }
    return extracted.existing_condition_id;
  }

  if (extracted.icd_code && icdLookupResult?.found) {
    const byCode = await deps.repository.findConditionByIcd(personId, extracted.icd_code);
    if (byCode) return byCode.id;

    const created = await deps.repository.createCondition({
      person_id: personId,
      name: extracted.name,
      code: extracted.icd_code,
      icd_name_en: icdLookupResult.name_en,
      icd_name_ru: icdLookupResult.name_ru,
      current_status: extracted.status,
    });
    return created?.id ?? null;
  }

  const normalizedName = normalizeText(extracted.name);
  if (!normalizedName) return null;

  const byName = await deps.repository.findConditionByName(personId, normalizedName);
  if (byName) return byName.id;

  const created = await deps.repository.createCondition({
    person_id: personId,
    name: normalizedName,
    code: extracted.icd_code ?? null,
    icd_name_en: icdLookupResult?.name_en ?? null,
    icd_name_ru: icdLookupResult?.name_ru ?? null,
    current_status: extracted.status,
  });
  return created?.id ?? null;
}

export async function processExtractedConditions(
  recordId: string,
  personId: string,
  conditions: ExtractedCondition[],
  deps: ResolutionDeps,
): Promise<void> {
  for (const extracted of conditions) {
    try {
      const conditionId = await resolveOrCreateCondition(extracted, personId, deps);
      if (!conditionId) {
        deps.log?.warn?.("Skipping condition without identifier or name");
        continue;
      }

      await deps.repository.insertConditionRecord({
        condition_id: conditionId,
        record_id: recordId,
        status_in_record: extracted.status,
        source_anchor: extracted.source_anchor,
        confidence: extracted.confidence,
        is_llm_extracted: true,
        is_user_verified: false,
      });
      await deps.repository.recomputeConditionCurrentStatus(conditionId);
    } catch (error) {
      deps.log?.error?.("Failed to process extracted condition:", error);
    }
  }
}

function matchExistingFinding(
  toResolve: FindingToResolve,
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
        size_mm: 0,
        count: 0,
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
