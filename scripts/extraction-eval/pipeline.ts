// The imports below reach into supabase/functions, which runs on Deno. Without this ambient
// declaration the web typecheck fails on `Cannot find name 'Deno'` in modules pulled in
// transitively (repository.ts, observability.ts). It is a types-only concern — nothing
// under stages/ touches `Deno` at runtime. There is nothing to `import` from a global
// declaration file, so the reference form is the only one available here.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../supabase/functions/_shared/deno.d.ts" />
/**
 * Runs a case through the real pipeline and normalises the result into the corpus shape.
 *
 * Deliberately calls both halves of production: `runStagedParse` for the model stages, then the
 * builders from service.ts for the deterministic half — code resolution, is_applied, and unit
 * canonicalisation. Scoring only the stage output would miss every defect that lives after them,
 * including the Cyrillic-unit one documented in the corpus README.
 */
import { runStagedParse } from "../../supabase/functions/health-structure/stages/index.ts";
import type { HealthStructureParseContext } from "../../supabase/functions/health-structure/service.ts";
import {
  buildCheckupSuggestions,
  buildFindingRows,
  buildObservationRows,
} from "../../supabase/functions/health-structure/service.ts";
import type { CaseDiagnostics, CaseSnapshot } from "./types.ts";

const FIXTURE_RECORD_ID = "00000000-0000-4000-a000-000000000001";
const FIXTURE_PERSON_ID = "00000000-0000-4000-a000-000000000002";

export interface RunOptions {
  fetchFn: typeof fetch;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function runCasePipeline(
  ocrText: string,
  context: HealthStructureParseContext,
  options: RunOptions,
): Promise<{ snapshot: CaseSnapshot; diagnostics: CaseDiagnostics }> {
  const outcome = await runStagedParse(ocrText, context, {
    fetchFn: options.fetchFn,
    apiKey: options.apiKey,
    defaultModel: options.model,
    timeoutMs: options.timeoutMs,
    // Determinism: no real backoff waits, no jitter, and one attempt so a transport failure is
    // reported rather than silently retried into a different sampled answer.
    sleepFn: async () => {},
    jitterFn: () => 0,
    maxAttempts: 1,
  });

  const structured = outcome.structured;
  const observations = buildObservationRows(
    FIXTURE_RECORD_ID,
    structured,
    context.observationCatalog,
  );
  const findings = buildFindingRows(
    FIXTURE_RECORD_ID,
    FIXTURE_PERSON_ID,
    structured,
    context.findingTypeCatalog,
    context.bodySiteCatalog,
  );
  const checkups = buildCheckupSuggestions(structured, context.checkupItems) ?? [];

  const snapshot: CaseSnapshot = {
    record_type: str(structured.record_type),
    record_date: str(structured.record_date),
    observations: observations.rows.map((row) => ({
      obs_name: String(row.obs_name ?? ""),
      obs_code: str(row.obs_code),
      value_numeric: num(row.value_numeric),
      unit: str(row.unit),
      ref_range_low: num(row.ref_range_low),
      ref_range_high: num(row.ref_range_high),
      status: str(row.status),
      value_canonical: num(row.value_canonical),
      unit_canonical: str(row.unit_canonical),
      is_applied: row.is_applied === true,
    })),
    findings: findings.rows.map((row) => ({
      finding_code: str(row.finding_code),
      finding_type_text: String(row.finding_type_text ?? ""),
      site_code: str(row.site_code),
      body_site_text: str(row.body_site_text),
      size_mm: num(row.size_mm),
      severity: str(row.severity),
      laterality: str(row.laterality),
      count: num(row.count),
    })),
    conditions: structured.conditions.map((condition) => ({
      name: condition.name,
      icd_code: condition.icd_code,
      status: condition.status,
    })),
    findings_to_resolve: structured.findings_to_resolve.map((item) => ({
      finding_type_text: item.finding_type_text,
      finding_code: item.finding_code,
      site_code: item.site_code,
      body_site_text: item.body_site_text,
    })),
    conditions_to_resolve: structured.conditions_to_resolve.map((item) => ({
      condition_id: item.condition_id,
      supporting_obs_code: str(item.supporting_obs_code),
    })),
    checkups_to_complete: checkups.map((row) => ({
      checkup_item_id: String(row.checkup_item_id ?? ""),
      suggested_done_at: str(row.suggested_done_at),
    })),
  };

  return {
    snapshot,
    diagnostics: {
      stagesRun: outcome.stagesRun,
      rejected: outcome.rejected,
      droppedInvalidCount: observations.droppedInvalidCount + findings.droppedInvalidCount,
      unresolvedCatalogCount: observations.unresolvedCatalogCount + findings.unresolvedCatalogCount,
      promptTokens: outcome.usage.promptTokens,
      completionTokens: outcome.usage.completionTokens,
      costUsd: outcome.usage.costUsd,
    },
  };
}
