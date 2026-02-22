import {
  findBodySiteCatalogEntry,
  findCatalogEntry,
  findFindingTypeCatalogEntry,
} from "./catalog.ts";
import {
  processConditionsToResolve,
  processExtractedConditions,
  processFindingsToResolve,
} from "./resolution.ts";
import type { HealthStructureRepository } from "./repository.ts";
import type { IcdLookupResult, StructuredDataWithEntities } from "./types.ts";
import { convertRefRangeToCanonical, convertToCanonical } from "./unit-conversion.ts";

export interface HealthStructureServiceInput {
  authToken: string | null;
  recordId: string | null;
}

export interface HealthStructureParseContext {
  observationCatalog: Awaited<ReturnType<HealthStructureRepository["fetchObservationCatalog"]>>;
  findingTypeCatalog: Awaited<ReturnType<HealthStructureRepository["fetchFindingTypeCatalog"]>>;
  bodySiteCatalog: Awaited<ReturnType<HealthStructureRepository["fetchBodySiteCatalog"]>>;
  existingConditions: Awaited<ReturnType<HealthStructureRepository["fetchPersonConditions"]>>;
  existingFindings: Awaited<ReturnType<HealthStructureRepository["fetchPersonActiveFindings"]>>;
  checkupItems: Awaited<ReturnType<HealthStructureRepository["fetchUpcomingOverdueCheckupItems"]>>;
}

export interface HealthStructureServiceDeps {
  repository: HealthStructureRepository;
  parseStructuredData: (
    ocrText: string,
    context: HealthStructureParseContext,
  ) => Promise<StructuredDataWithEntities>;
  lookupIcdCode: (code: string) => Promise<IcdLookupResult | null>;
  log?: Pick<Console, "log" | "warn" | "error">;
}

type ServiceResult = {
  status: number;
  payload: Record<string, unknown>;
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildCheckupSuggestions(
  structured: StructuredDataWithEntities,
  checkupItems: HealthStructureParseContext["checkupItems"],
): Record<string, unknown>[] | null {
  if (structured.checkups_to_complete.length === 0) return null;
  return structured.checkups_to_complete
    .filter((item) => item.checkup_item_id && item.checkup_item_id.trim().length > 0)
    .map((item) => {
      const checkup = checkupItems.find((candidate) => candidate.id === item.checkup_item_id);
      return {
        checkup_item_id: item.checkup_item_id,
        reason: item.reason || "",
        suggested_done_at: item.suggested_done_at,
        checkup_title: checkup?.title ?? "Checkup",
      };
    });
}

function buildObservationRows(
  recordId: string,
  structured: StructuredDataWithEntities,
  observationCatalog: HealthStructureParseContext["observationCatalog"],
): Record<string, unknown>[] {
  return structured.observations.map((obs) => {
    const catalogEntry = findCatalogEntry(obs.obs_code, observationCatalog);
    const { value_canonical, unit_canonical } = convertToCanonical(
      obs.value_numeric,
      obs.unit,
      catalogEntry,
    );
    const { ref_range_low_canonical, ref_range_high_canonical } = convertRefRangeToCanonical(
      obs.ref_range_low,
      obs.ref_range_high,
      obs.unit,
      catalogEntry,
    );

    return {
      record_id: recordId,
      catalog_id: catalogEntry?.id ?? null,
      obs_code: obs.obs_code,
      obs_name: obs.obs_name,
      value_numeric: obs.value_numeric,
      value_text: obs.value,
      unit: obs.unit,
      value_canonical,
      unit_canonical,
      ref_range_text: obs.ref_range,
      ref_range_low: obs.ref_range_low,
      ref_range_high: obs.ref_range_high,
      ref_range_low_canonical,
      ref_range_high_canonical,
      status: obs.status,
      is_llm_extracted: true,
      is_user_verified: false,
      is_applied: obs.obs_code !== null,
      confidence: obs.confidence,
    };
  });
}

function buildFindingRows(
  recordId: string,
  personId: string,
  structured: StructuredDataWithEntities,
  findingTypeCatalog: HealthStructureParseContext["findingTypeCatalog"],
  bodySiteCatalog: HealthStructureParseContext["bodySiteCatalog"],
): Record<string, unknown>[] {
  return structured.findings
    .filter((item) => item.source_anchor && item.source_anchor.trim().length > 0)
    .map((item) => {
      const findingTypeEntry = findFindingTypeCatalogEntry(item.finding_code, findingTypeCatalog);
      const bodySiteEntry = findBodySiteCatalogEntry(item.site_code, bodySiteCatalog);

      return {
        person_id: personId,
        record_id: recordId,
        finding_type_id: findingTypeEntry?.id ?? null,
        finding_code: item.finding_code,
        finding_type_text: item.finding_type_text,
        body_site_id: bodySiteEntry?.id ?? null,
        site_code: item.site_code,
        body_site_text: item.body_site_text,
        size_mm: item.size_mm,
        count: item.count || 1,
        severity: item.severity,
        laterality: item.laterality,
        morphology: item.morphology,
        description: item.description,
        histology: item.histology,
        finding_date: item.finding_date || structured.record_date || null,
        source_anchor: item.source_anchor,
        is_llm_extracted: true,
        is_user_verified: false,
        confidence: item.confidence,
      };
    });
}

export async function runHealthStructureService(
  input: HealthStructureServiceInput,
  deps: HealthStructureServiceDeps,
): Promise<ServiceResult> {
  try {
    if (!input.authToken) throw new Error("Missing authorization header");
    const user = await deps.repository.authenticateAllowedUser(input.authToken);
    if (!user) throw new Error("Unauthorized - invalid token");

    if (!input.recordId) throw new Error("Missing required field: record_id");

    const record = await deps.repository.getRecord(input.recordId);
    if (!record) throw new Error("Record not found or access denied");
    const personId = asString(record.person_id);
    if (!personId) throw new Error("Record is missing person_id");
    const ocrText = asString(record.ocr_text);
    if (!ocrText) throw new Error("No OCR text found for this record. Run health-ocr first.");

    const [
      observationCatalog,
      findingTypeCatalog,
      bodySiteCatalog,
      existingConditions,
      existingFindings,
      checkupItems,
    ] = await Promise.all([
      deps.repository.fetchObservationCatalog(),
      deps.repository.fetchFindingTypeCatalog(),
      deps.repository.fetchBodySiteCatalog(),
      deps.repository.fetchPersonConditions(personId),
      deps.repository.fetchPersonActiveFindings(personId),
      deps.repository.fetchUpcomingOverdueCheckupItems(personId),
    ]);

    const context: HealthStructureParseContext = {
      observationCatalog,
      findingTypeCatalog,
      bodySiteCatalog,
      existingConditions,
      existingFindings,
      checkupItems,
    };

    const structuredData = await deps.parseStructuredData(ocrText, context);
    const checkupSuggestions = buildCheckupSuggestions(structuredData, checkupItems);

    await deps.repository.updateMedicalRecord(input.recordId, {
      title: structuredData.title,
      record_type: structuredData.record_type,
      record_date: structuredData.record_date,
      notes: structuredData.summary,
      llm_summary: structuredData.summary,
      llm_keywords: structuredData.keywords,
      llm_suggested_checkup_completions: checkupSuggestions,
      status: "structure_review",
    });

    const observationRows = buildObservationRows(
      input.recordId,
      structuredData,
      observationCatalog,
    );
    await deps.repository.replaceRecordObservations(input.recordId, observationRows);

    const findingRows = buildFindingRows(
      input.recordId,
      personId,
      structuredData,
      findingTypeCatalog,
      bodySiteCatalog,
    );
    await deps.repository.replaceRecordFindings(input.recordId, findingRows);

    await deps.repository.clearConditionRecords(input.recordId);
    await processExtractedConditions(input.recordId, personId, structuredData.conditions, {
      repository: deps.repository,
      lookupIcdCode: deps.lookupIcdCode,
      log: deps.log,
    });

    await processFindingsToResolve(
      input.recordId,
      personId,
      structuredData.record_date ?? null,
      structuredData.findings_to_resolve,
      existingFindings,
      {
        repository: deps.repository,
        lookupIcdCode: deps.lookupIcdCode,
        log: deps.log,
      },
    );

    await processConditionsToResolve(
      input.recordId,
      structuredData.conditions_to_resolve,
      existingConditions,
      {
        repository: deps.repository,
        lookupIcdCode: deps.lookupIcdCode,
        log: deps.log,
      },
    );

    return {
      status: 200,
      payload: {
        success: true,
        structured_data: structuredData,
      },
    };
  } catch (error) {
    return {
      status: 400,
      payload: {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}
