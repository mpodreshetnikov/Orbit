import { resolveBodySite, resolveFindingType, resolveObservation } from "./catalog.ts";
import {
  processConditionsToResolve,
  processExtractedConditions,
  processFindingsToResolve,
} from "./resolution.ts";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import type { HealthStructureRepository } from "./repository.ts";
import { usageAttrs } from "../_shared/llm-usage.ts";
import type {
  IcdLookupResult,
  StructuredDataWithEntities,
  StructuredParseOutcome,
} from "./types.ts";
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
  ) => Promise<StructuredParseOutcome>;
  lookupIcdCode: (code: string) => Promise<IcdLookupResult | null>;
  log?: Pick<Console, "log" | "warn" | "error">;
  telemetry?: EdgeTelemetry;
}

type ServiceResult = {
  status: number;
  payload: Record<string, unknown>;
};

export type PersistRowsResult = {
  rows: Record<string, unknown>[];
  droppedInvalidCount: number;
  unresolvedCatalogCount: number;
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildCheckupSuggestions(
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

export function buildObservationRows(
  recordId: string,
  structured: StructuredDataWithEntities,
  observationCatalog: HealthStructureParseContext["observationCatalog"],
): PersistRowsResult {
  const rows: Record<string, unknown>[] = [];
  let droppedInvalidCount = 0;
  let unresolvedCatalogCount = 0;

  for (const obs of structured.observations) {
    // Resolve from the printed label as well as the model's code. The model's code is a hint;
    // an unmatched one used to leave catalog_id null, which set is_applied false, which silently
    // excluded the value from the patient's history with no signal anywhere in the UI.
    const resolution = resolveObservation(obs.obs_code, obs.obs_name, observationCatalog);
    const catalogEntry = resolution.kind === "resolved" ? resolution.entry : null;
    const obsName = asString(obs.obs_name) ?? catalogEntry?.name_en ?? catalogEntry?.name_ru;
    if (!obsName) {
      droppedInvalidCount += 1;
      continue;
    }
    if (!catalogEntry) {
      unresolvedCatalogCount += 1;
    }

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

    rows.push({
      record_id: recordId,
      catalog_id: catalogEntry?.id ?? null,
      // Store the resolved code, never the model's guess. A code that resolved to nothing is
      // stored as null so downstream lookups and the review UI agree on what "unmatched" means.
      obs_code: catalogEntry?.obs_code ?? null,
      obs_name: obsName,
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
      is_applied: catalogEntry !== null,
      confidence: obs.confidence,
    });
  }

  return { rows, droppedInvalidCount, unresolvedCatalogCount };
}

export function buildFindingRows(
  recordId: string,
  personId: string,
  structured: StructuredDataWithEntities,
  findingTypeCatalog: HealthStructureParseContext["findingTypeCatalog"],
  bodySiteCatalog: HealthStructureParseContext["bodySiteCatalog"],
): PersistRowsResult {
  const rows: Record<string, unknown>[] = [];
  let droppedInvalidCount = 0;
  let unresolvedCatalogCount = 0;

  for (const item of structured.findings) {
    const findingResolution = resolveFindingType(
      item.finding_code,
      item.finding_type_text,
      findingTypeCatalog,
    );
    const siteResolution = resolveBodySite(item.site_code, item.body_site_text, bodySiteCatalog);
    const findingTypeEntry = findingResolution.kind === "resolved" ? findingResolution.entry : null;
    const bodySiteEntry = siteResolution.kind === "resolved" ? siteResolution.entry : null;
    const sourceAnchor = asString(item.source_anchor);
    const findingTypeText =
      asString(item.finding_type_text) ?? findingTypeEntry?.name_en ?? findingTypeEntry?.name_ru;

    if (!sourceAnchor || !findingTypeText) {
      droppedInvalidCount += 1;
      continue;
    }
    if (!findingTypeEntry || (item.body_site_text && !bodySiteEntry)) {
      unresolvedCatalogCount += 1;
    }

    rows.push({
      person_id: personId,
      record_id: recordId,
      finding_type_id: findingTypeEntry?.id ?? null,
      finding_code: findingTypeEntry?.finding_code ?? null,
      finding_type_text: findingTypeText,
      body_site_id: bodySiteEntry?.id ?? null,
      site_code: bodySiteEntry?.site_code ?? null,
      body_site_text: item.body_site_text,
      size_mm: item.size_mm,
      // A real zero is a real count. It used to be coerced to 1 because zero meant "resolved".
      count: item.count ?? null,
      severity: item.severity,
      laterality: item.laterality,
      morphology: item.morphology,
      description: item.description,
      histology: item.histology,
      finding_date: item.finding_date || structured.record_date || null,
      source_anchor: sourceAnchor,
      is_llm_extracted: true,
      is_user_verified: false,
      confidence: item.confidence,
    });
  }

  return { rows, droppedInvalidCount, unresolvedCatalogCount };
}

export async function runHealthStructureService(
  input: HealthStructureServiceInput,
  deps: HealthStructureServiceDeps,
): Promise<ServiceResult> {
  const telemetry = deps.telemetry;
  const serviceSpan = telemetry?.startSpan("edge.health_structure.service");
  // The failure write below uses the service-role client and this function runs with
  // verify_jwt = false, so it must not be reachable before the caller has been authenticated
  // and the record resolved -- otherwise anyone who guesses a record id could stamp it.
  let mayRecordFailure = false;
  let runId: string | null = null;
  try {
    telemetry?.info("health_structure_service_started", {
      has_record_id: Boolean(input.recordId),
    });

    const authSpan = telemetry?.startSpan("edge.health_structure.auth");
    if (!input.authToken) {
      await authSpan?.end({
        status: "error",
        statusMessage: "Missing authorization header",
      });
      throw new Error("Missing authorization header");
    }
    const user = await deps.repository.authenticateAllowedUser(input.authToken);
    if (!user) {
      await authSpan?.end({
        status: "error",
        statusMessage: "Unauthorized - invalid token",
      });
      throw new Error("Unauthorized - invalid token");
    }
    await authSpan?.end({ status: "ok" });

    if (!input.recordId) throw new Error("Missing required field: record_id");

    const recordSpan = telemetry?.startSpan("edge.health_structure.get_record");
    const record = await deps.repository.getRecord(input.recordId);
    if (!record) throw new Error("Record not found or access denied");
    const personId = asString(record.person_id);
    if (!personId) throw new Error("Record is missing person_id");
    // The claim is taken server-side, after the record is known to exist: the client used to
    // write `structuring` before invoking, which let two callers both believe they had the work.
    const claimSpan = telemetry?.startSpan("edge.health_structure.claim");
    runId = await deps.repository.claimRecord(input.recordId);
    if (!runId) {
      await claimSpan?.end({ status: "ok", attrs: { claimed: false } });
      telemetry?.info("health_structure_already_running", { record_id: input.recordId });
      // Not a failure of this record: another run owns it, and stamping structure_error here
      // would report that run's progress as this caller's error.
      mayRecordFailure = false;
      await serviceSpan?.end({ status: "ok", attrs: { claimed: false } });
      return {
        status: 409,
        payload: { success: false, error: "Structuring is already running for this record" },
      };
    }
    await claimSpan?.end({ status: "ok", attrs: { claimed: true } });
    // Only a run that holds the claim may write a failure: before this point an error belongs to
    // a caller that never owned the record, and stamping it would clear the owner's claim.
    mayRecordFailure = true;

    const ocrText = asString(record.ocr_text);
    if (!ocrText) throw new Error("No OCR text found for this record. Run health-ocr first.");
    await recordSpan?.end({
      status: "ok",
      attrs: {
        has_person_id: true,
        ocr_text_chars: ocrText.length,
      },
    });

    const contextSpan = telemetry?.startSpan("edge.health_structure.load_context");
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
    await contextSpan?.end({
      status: "ok",
      attrs: {
        observation_catalog_count: observationCatalog.length,
        finding_type_catalog_count: findingTypeCatalog.length,
        body_site_catalog_count: bodySiteCatalog.length,
      },
    });

    const context: HealthStructureParseContext = {
      observationCatalog,
      findingTypeCatalog,
      bodySiteCatalog,
      existingConditions,
      existingFindings,
      checkupItems,
    };

    const parseSpan = telemetry?.startSpan("edge.health_structure.parse_llm");
    const parseOutcome = await deps.parseStructuredData(ocrText, context);
    const structuredData = parseOutcome.structured;
    await parseSpan?.end({
      status: "ok",
      attrs: {
        observation_count: structuredData.observations.length,
        finding_count: structuredData.findings.length,
        condition_count: structuredData.conditions.length,
        // On the record's own span, so per-record cost is readable off the trace rather than
        // off an uncorrelated log line. Absent values are omitted, never sent as zero.
        ...usageAttrs(parseOutcome.usage),
        ...(parseOutcome.stagesRun.length > 0
          ? { stages_run: parseOutcome.stagesRun.join(",") }
          : {}),
      },
    });
    const checkupSuggestions = buildCheckupSuggestions(structuredData, checkupItems);

    const updateRecordSpan = telemetry?.startSpan("edge.health_structure.update_record");
    await deps.repository.updateMedicalRecord(
      input.recordId,
      {
        title: structuredData.title,
        record_type: structuredData.record_type,
        record_date: structuredData.record_date,
        // `notes` is user-editable and deliberately not written here. It previously received the
        // same text as llm_summary, so re-running structuring silently overwrote whatever the user
        // had typed.
        llm_summary: structuredData.summary,
        llm_keywords: structuredData.keywords,
        llm_suggested_checkup_completions: checkupSuggestions,
        status: "structure_review",
        // A previous failure is cleared by the run that succeeds, the way ocr_error is.
        structure_error: null,
      },
      { runId },
    );
    await updateRecordSpan?.end({ status: "ok" });

    const observationSpan = telemetry?.startSpan("edge.health_structure.persist_observations");
    const observationBuild = buildObservationRows(
      input.recordId,
      structuredData,
      observationCatalog,
    );
    await deps.repository.replaceRecordObservations(input.recordId, observationBuild.rows);
    if (observationBuild.droppedInvalidCount > 0) {
      telemetry?.warn("health_structure_invalid_observations_dropped", {
        record_id: input.recordId,
        dropped_count: observationBuild.droppedInvalidCount,
      });
    }
    if (observationBuild.unresolvedCatalogCount > 0) {
      telemetry?.info("health_structure_unresolved_observation_catalog_refs", {
        record_id: input.recordId,
        unresolved_count: observationBuild.unresolvedCatalogCount,
      });
    }
    await observationSpan?.end({
      status: "ok",
      attrs: {
        row_count: observationBuild.rows.length,
        dropped_invalid_count: observationBuild.droppedInvalidCount,
        unresolved_catalog_count: observationBuild.unresolvedCatalogCount,
      },
    });

    const findingSpan = telemetry?.startSpan("edge.health_structure.persist_findings");
    const findingBuild = buildFindingRows(
      input.recordId,
      personId,
      structuredData,
      findingTypeCatalog,
      bodySiteCatalog,
    );
    await deps.repository.replaceRecordFindings(input.recordId, findingBuild.rows);
    if (findingBuild.droppedInvalidCount > 0) {
      telemetry?.warn("health_structure_invalid_findings_dropped", {
        record_id: input.recordId,
        dropped_count: findingBuild.droppedInvalidCount,
      });
    }
    if (findingBuild.unresolvedCatalogCount > 0) {
      telemetry?.info("health_structure_unresolved_finding_catalog_refs", {
        record_id: input.recordId,
        unresolved_count: findingBuild.unresolvedCatalogCount,
      });
    }
    await findingSpan?.end({
      status: "ok",
      attrs: {
        row_count: findingBuild.rows.length,
        dropped_invalid_count: findingBuild.droppedInvalidCount,
        unresolved_catalog_count: findingBuild.unresolvedCatalogCount,
      },
    });

    const resolutionSpan = telemetry?.startSpan("edge.health_structure.resolve_entities");
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
    await resolutionSpan?.end({ status: "ok" });

    // Only now is the record's content complete. Releasing the claim with the status write above
    // would have opened the record to a second run while observations, findings and resolutions
    // were still being written -- two workers deleting and inserting the same rows.
    const releaseSpan = telemetry?.startSpan("edge.health_structure.release_claim");
    await deps.repository.updateMedicalRecord(
      input.recordId,
      { processing_run_id: null, processing_started_at: null },
      { runId },
    );
    await releaseSpan?.end({ status: "ok" });

    telemetry?.info("health_structure_service_completed", {
      record_id: input.recordId,
      observation_count: structuredData.observations.length,
      finding_count: structuredData.findings.length,
      condition_count: structuredData.conditions.length,
    });
    await serviceSpan?.end({ status: "ok" });

    return {
      status: 200,
      payload: {
        success: true,
        structured_data: structuredData,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    telemetry?.error("health_structure_service_failed", {
      record_id: input.recordId ?? "missing",
      error_message: message,
    });
    // Durable trace of the failure, and only for a caller who got past authentication and whose
    // record was found. Best-effort on purpose: the original error is what the caller must see,
    // so a record that cannot be written must not replace it with a second one.
    if (mayRecordFailure && input.recordId) {
      try {
        await deps.repository.updateMedicalRecord(
          input.recordId,
          {
            structure_error: message,
            // Back to where a retry starts from. Leaving `structuring` behind would show the
            // record as being worked on by a run that no longer exists -- the client-side
            // rollback only happens when a browser is still there to do it.
            status: "ocr_review",
            // Release the claim so a retry is not locked out until the lease expires.
            processing_run_id: null,
            processing_started_at: null,
          },
          { runId: runId ?? undefined },
        );
      } catch (writeError) {
        // Includes the case where the claim was lost: a worker that no longer owns the record
        // must not stamp its error over whatever replaced it.
        deps.log?.error?.("[health-structure] failed to persist structure_error:", writeError);
      }
    }
    await serviceSpan?.end({
      status: "error",
      statusMessage: message,
    });
    return {
      status: 400,
      payload: {
        success: false,
        error: message,
      },
    };
  }
}
