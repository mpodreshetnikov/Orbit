export type FindingResolutionStatus = "observed" | "resolved";

// ============================================================================
// FINDING TYPES
// Types for medical findings (polyps, stones, cysts, etc.)
// ============================================================================

// Severity enum
export type FindingSeverity = "mild" | "moderate" | "severe" | "unknown";
export const FINDING_SEVERITIES: FindingSeverity[] = ["mild", "moderate", "severe", "unknown"];

// Laterality enum
export type FindingLaterality = "left" | "right" | "bilateral" | "none";
export const FINDING_LATERALITIES: FindingLaterality[] = ["left", "right", "bilateral", "none"];

// ============================================================================
// CATALOG TYPES
// ============================================================================

// Finding type catalog entry
export interface FindingTypeCatalog {
  id: string;
  finding_code: string;
  name_ru: string;
  name_en: string;
  synonyms_ru: string[];
  synonyms_en: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Body site catalog entry
export interface BodySiteCatalog {
  id: string;
  site_code: string;
  name_ru: string;
  name_en: string;
  parent_site_code: string | null;
  synonyms_ru: string[];
  synonyms_en: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Input for creating a new finding type
export interface CreateFindingTypeInput {
  finding_code: string;
  name_ru: string;
  name_en: string;
  synonyms_ru?: string[];
  synonyms_en?: string[];
  notes?: string | null;
}

// Input for updating a finding type
export interface UpdateFindingTypeInput {
  finding_code?: string;
  name_ru?: string;
  name_en?: string;
  synonyms_ru?: string[];
  synonyms_en?: string[];
  notes?: string | null;
}

// Input for creating a new body site
export interface CreateBodySiteInput {
  site_code: string;
  name_ru: string;
  name_en: string;
  parent_site_code?: string | null;
  synonyms_ru?: string[];
  synonyms_en?: string[];
  notes?: string | null;
}

// Input for updating a body site
export interface UpdateBodySiteInput {
  site_code?: string;
  name_ru?: string;
  name_en?: string;
  parent_site_code?: string | null;
  synonyms_ru?: string[];
  synonyms_en?: string[];
  notes?: string | null;
}

// ============================================================================
// RECORD FINDING TYPES
// ============================================================================

// Base record finding type
export interface RecordFinding {
  id: string;
  person_id: string;
  record_id: string;
  // Finding type - dual storage
  finding_type_id: string | null;
  finding_code: string | null;
  finding_type_text: string;
  // Body site - dual storage
  body_site_id: string | null;
  site_code: string | null;
  body_site_text: string | null;
  // Attributes
  size_mm: number | null;
  count: number | null;
  severity: FindingSeverity;
  laterality: FindingLaterality;
  morphology: string | null;
  description: string | null;
  histology: string | null;
  finding_date: string | null;
  source_anchor: string;
  // Metadata
  is_llm_extracted: boolean;
  is_user_verified: boolean;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

// Record finding with catalog joins (from get_record_findings function)
export interface RecordFindingWithCatalog extends RecordFinding {
  // From finding_type_catalog join
  catalog_finding_name_ru: string | null;
  catalog_finding_name_en: string | null;
  // From body_site_catalog join
  catalog_site_name_ru: string | null;
  catalog_site_name_en: string | null;
}

// Input for creating a new record finding
export interface CreateRecordFindingInput {
  person_id: string;
  record_id: string;
  finding_type_id?: string | null;
  finding_code?: string | null;
  finding_type_text: string;
  body_site_id?: string | null;
  site_code?: string | null;
  body_site_text?: string | null;
  size_mm?: number | null;
  count?: number | null;
  severity?: FindingSeverity;
  laterality?: FindingLaterality;
  morphology?: string | null;
  description?: string | null;
  histology?: string | null;
  finding_date?: string | null;
  resolution_status?: FindingResolutionStatus;
  source_anchor: string;
  is_llm_extracted?: boolean;
  is_user_verified?: boolean;
  confidence?: number | null;
}

// Input for updating a record finding
export interface UpdateRecordFindingInput {
  finding_type_id?: string | null;
  finding_code?: string | null;
  finding_type_text?: string;
  body_site_id?: string | null;
  site_code?: string | null;
  body_site_text?: string | null;
  size_mm?: number | null;
  count?: number | null;
  severity?: FindingSeverity;
  laterality?: FindingLaterality;
  morphology?: string | null;
  description?: string | null;
  histology?: string | null;
  finding_date?: string | null;
  source_anchor?: string;
  is_user_verified?: boolean;
}

// ============================================================================
// FINDING HISTORY TYPES (for aggregated views)
// ============================================================================

// Single history point for a finding
export interface FindingHistoryPoint {
  id: string;
  record_id: string;
  record_date: string | null;
  size_mm: number | null;
  count: number | null;
  /** 'resolved' marks a row that closes an earlier finding rather than measuring one. */
  resolution_status: FindingResolutionStatus;
  severity: FindingSeverity;
  laterality: FindingLaterality;
  morphology: string | null;
  description: string | null;
  histology: string | null;
  source_anchor: string;
  created_at: string;
}

// Aggregated finding summary (grouped by finding_code + site_code)
export interface FindingSummary {
  // Grouping keys
  finding_code: string | null;
  finding_type_text: string;
  site_code: string | null;
  body_site_text: string | null;
  // Catalog info
  finding_type_id: string | null;
  body_site_id: string | null;
  catalog_finding_name_ru: string | null;
  catalog_finding_name_en: string | null;
  catalog_site_name_ru: string | null;
  catalog_site_name_en: string | null;
  // Latest values
  latest_size_mm: number | null;
  latest_count: number | null;
  latest_severity: FindingSeverity;
  latest_laterality: FindingLaterality;
  latest_date: string | null;
  // Resolved status (true if latest size=0 or count=0, meaning finding is gone)
  is_resolved: boolean;
  // Aggregates
  occurrence_count: number;
  history: FindingHistoryPoint[];
}
