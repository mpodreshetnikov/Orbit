import type { LlmUsage } from "../_shared/llm-usage.ts";

export interface StructureRequest {
  record_id: string;
}

export interface StructuredData {
  record_type: string;
  title: string;
  record_date: string | null;
  summary: string;
  keywords: string[];
}

export interface ExtractedObservation {
  obs_code: string | null;
  obs_name: string;
  value: string;
  value_numeric: number | null;
  unit: string | null;
  ref_range: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  status: "normal" | "low" | "high" | "critical_low" | "critical_high" | "unknown" | null;
  confidence: number;
  /**
   * Verbatim snippet from the document evidencing this value. Optional for backward
   * compatibility with the pre-staged parser; the extraction stage always sets it and drops
   * observations whose anchor cannot be found in the document text.
   */
  source_anchor?: string | null;
}

export interface ExtractedFinding {
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
  size_mm: number | null;
  count: number | null;
  severity: "mild" | "moderate" | "severe" | "unknown";
  laterality: "left" | "right" | "bilateral" | "none";
  morphology: string | null;
  description: string | null;
  histology: string | null;
  finding_date: string | null;
  source_anchor: string;
  confidence: number;
}

export interface ExtractedCondition {
  existing_condition_id: string | null;
  name: string;
  icd_code: string | null;
  status: "active" | "resolved" | "suspected" | "history";
  confidence: number;
  source_anchor: string | null;
}

export interface FindingToResolve {
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
  reason: string;
  source_anchor: string;
  confidence: number;
}

export interface ConditionToResolve {
  condition_id: string;
  reason: string;
  source_anchor: string;
  confidence: number;
}

export interface CheckupToComplete {
  checkup_item_id: string;
  reason: string;
  suggested_done_at: string;
}

export interface StructuredDataWithEntities extends StructuredData {
  observations: ExtractedObservation[];
  findings: ExtractedFinding[];
  conditions: ExtractedCondition[];
  findings_to_resolve: FindingToResolve[];
  conditions_to_resolve: ConditionToResolve[];
  checkups_to_complete: CheckupToComplete[];
}

export interface ObservationCatalogItem {
  id: string;
  obs_code: string;
  name_ru: string;
  name_en: string;
  canonical_unit: string;
  synonyms_ru: string[];
  synonyms_en: string[];
  accepted_units: Record<string, { factor_to_canonical?: number; formula_to_canonical?: string }>;
}

export interface FindingTypeCatalogItem {
  id: string;
  finding_code: string;
  name_ru: string;
  name_en: string;
  synonyms_ru: string[];
  synonyms_en: string[];
}

export interface BodySiteCatalogItem {
  id: string;
  site_code: string;
  name_ru: string;
  name_en: string;
  parent_site_code: string | null;
  synonyms_ru: string[];
  synonyms_en: string[];
}

export interface ExistingCondition {
  id: string;
  name: string;
  code: string | null;
  current_status: string;
  onset_date: string | null;
  resolved_date: string | null;
}

export interface ExistingFinding {
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
  finding_type_id: string | null;
  body_site_id: string | null;
}

export interface CheckupItemForContext {
  id: string;
  title: string;
  category: string;
  next_due_at: string | null;
}

export interface IcdLookupResult {
  code: string;
  name_en: string | null;
  name_ru: string | null;
  found: boolean;
}

/**
 * What one structuring pass produced, and what it cost.
 *
 * The cost travels with the result rather than being logged where it is measured: a loose log
 * line carries no trace id, so per-record cost cannot be read off the record's own span. The
 * service puts these on `edge.health_structure.parse_llm`.
 */
export interface StructuredParseOutcome {
  structured: StructuredDataWithEntities;
  usage: LlmUsage;
  /** Which stages actually ran. Empty for the non-staged parser and the E2E stub. */
  stagesRun: string[];
}
