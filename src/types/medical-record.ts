export type RecordType =
  | "lab"
  | "visit"
  | "imaging"
  | "prescription"
  | "vaccination"
  | "vet"
  | "procedure"
  | "other";

export type RecordStatus =
  | "draft" // Initial state after upload
  | "ocr_processing" // OCR in progress
  | "ocr_failed" // OCR failed; error in ocr_error, user can retry
  | "ocr_review" // OCR complete, awaiting user review
  | "structuring" // Structure extraction in progress
  | "structure_review" // Structure complete, awaiting user review
  | "processing" // Legacy: kept for backward compatibility
  | "active" // Finalized record
  | "removed"; // Soft deleted

/** LLM-suggested checkup completion (stored on record; applied only on Save & activate) */
export interface LlmSuggestedCheckupCompletion {
  checkup_item_id: string;
  reason: string;
  suggested_done_at: string; // date only YYYY-MM-DD
  checkup_title: string;
}

export interface MedicalRecord {
  id: string;
  person_id: string;
  created_by_user_id: string;
  record_type: RecordType;
  record_date: string | null;
  title: string;
  notes: string | null;
  status: RecordStatus;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
  // Extraction fields (populated by LLM in Stage 4)
  ocr_text: string | null;
  ocr_error: string | null; // Set when OCR fails; cleared on success or retry
  llm_summary: string | null;
  llm_keywords: string[] | null;
  /** LLM-suggested checkup completions; applied only when record is activated */
  llm_suggested_checkup_completions: LlmSuggestedCheckupCompletion[] | null;
}

export interface RecordAttachment {
  id: string;
  record_id: string;
  storage_path: string;
  mime_type: string;
  original_filename: string;
  file_size: number | null;
  sort_order: number;
  created_at: string;
}

// Extended types for UI
export interface MedicalRecordWithAttachments extends MedicalRecord {
  attachments: RecordAttachment[];
}

export interface MedicalRecordListItem extends MedicalRecord {
  attachment_count: number;
  search_rank?: number;
}

// Form types for creating/updating records
export interface CreateMedicalRecordInput {
  person_id: string;
  record_type?: RecordType;
  record_date?: string | null;
  title: string;
  notes?: string | null;
  status?: RecordStatus;
}

export interface UpdateMedicalRecordInput {
  record_type?: RecordType;
  record_date?: string | null;
  title?: string;
  notes?: string | null;
  status?: RecordStatus;
  ocr_text?: string | null;
  ocr_error?: string | null;
  llm_keywords?: string[] | null;
  llm_suggested_checkup_completions?: LlmSuggestedCheckupCompletion[] | null;
}

// Search/filter types
export interface MedicalRecordFilters {
  person_id?: string;
  record_type?: RecordType | null;
  status?: RecordStatus;
  search?: string;
}

// Record type labels for UI
export const RECORD_TYPE_LABELS: Record<RecordType, { en: string; ru: string }> = {
  lab: { en: "Lab Results", ru: "Анализы" },
  visit: { en: "Doctor Visit", ru: "Прием врача" },
  imaging: { en: "Imaging", ru: "Диагностика" },
  prescription: { en: "Prescription", ru: "Рецепт" },
  vaccination: { en: "Vaccination", ru: "Вакцинация" },
  vet: { en: "Vet Visit", ru: "Визит к ветеринару" },
  procedure: { en: "Procedure", ru: "Процедура / операция" },
  other: { en: "Other", ru: "Другое" },
};

export const RECORD_TYPES: RecordType[] = [
  "lab",
  "visit",
  "imaging",
  "prescription",
  "vaccination",
  "vet",
  "procedure",
  "other",
];

// ============================================================================
// OCR Workflow Types (Two-step pipeline)
// ============================================================================

// Step 1: OCR extraction result (from health-ocr)
export interface OcrResult {
  ocr_text: string;
}

export interface HealthOcrResponse {
  success: boolean;
  ocr_text?: string;
  char_count?: number;
  /** Document name suggested by OCR LLM; shown instead of "Processing" */
  suggested_title?: string;
  error?: string;
}

// Step 2: Structure extraction result (from health-structure)
export interface StructuredData {
  record_type: RecordType;
  title: string;
  record_date: string | null;
  summary: string;
  keywords: string[];
}

export interface HealthStructureResponse {
  success: boolean;
  structured_data?: StructuredData;
  error?: string;
}

// Legacy type for backward compatibility
export interface ExtractionResult {
  ocr_text: string;
  record_type: RecordType;
  title: string;
  record_date: string | null;
  summary: string;
  keywords: string[];
}

// ============================================================================
// Record Observations Types
// ============================================================================

export type ObservationStatus =
  | "normal"
  | "low"
  | "high"
  | "critical_low"
  | "critical_high"
  | "unknown";

export interface RecordObservation {
  id: string;
  record_id: string;
  catalog_id: string | null;
  obs_code: string | null;
  obs_name: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  value_canonical: number | null;
  unit_canonical: string | null;
  ref_range_text: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  ref_range_low_canonical: number | null;
  ref_range_high_canonical: number | null;
  status: ObservationStatus | null;
  is_llm_extracted: boolean;
  is_user_verified: boolean;
  is_applied: boolean;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

// Extended type with catalog details
export interface RecordObservationWithCatalog extends RecordObservation {
  catalog_name_ru: string | null;
  catalog_name_en: string | null;
  catalog_canonical_unit: string | null;
  // Default reference ranges from catalog (used when specific ref range is not available)
  default_ref_low: number | null;
  default_ref_high: number | null;
}

// Input type for creating/updating observations
export interface CreateRecordObservationInput {
  record_id: string;
  catalog_id?: string | null;
  obs_code?: string | null;
  obs_name: string;
  value_numeric?: number | null;
  value_text?: string | null;
  unit?: string | null;
  value_canonical?: number | null;
  unit_canonical?: string | null;
  ref_range_text?: string | null;
  ref_range_low?: number | null;
  ref_range_high?: number | null;
  ref_range_low_canonical?: number | null;
  ref_range_high_canonical?: number | null;
  status?: ObservationStatus | null;
  is_llm_extracted?: boolean;
  is_user_verified?: boolean;
  is_applied?: boolean;
  confidence?: number | null;
}

export interface UpdateRecordObservationInput {
  obs_code?: string | null;
  obs_name?: string;
  value_numeric?: number | null;
  value_text?: string | null;
  unit?: string | null;
  value_canonical?: number | null;
  unit_canonical?: string | null;
  ref_range_text?: string | null;
  ref_range_low?: number | null;
  ref_range_high?: number | null;
  ref_range_low_canonical?: number | null;
  ref_range_high_canonical?: number | null;
  status?: ObservationStatus | null;
  is_user_verified?: boolean;
  is_applied?: boolean;
}

// LLM extraction output format
export interface ExtractedObservation {
  obs_code: string | null; // Matched catalog code or null
  obs_name: string; // Name as found in document
  value: string; // Original value text
  value_numeric: number | null; // Parsed numeric value
  unit: string | null; // Unit as written
  ref_range: string | null; // Reference range text
  status: ObservationStatus | null;
  confidence: number;
}

// Extended StructuredData with observations
export interface StructuredDataWithObservations extends StructuredData {
  observations: ExtractedObservation[];
}

// ============================================================================
// Observation History Types
// ============================================================================

// Single observation data point for history
export interface ObservationHistoryPoint {
  id: string;
  record_id: string;
  record_date: string | null;
  value_numeric: number | null;
  value_text: string | null;
  value_canonical: number | null;
  unit: string | null;
  unit_canonical: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  ref_range_low_canonical: number | null;
  ref_range_high_canonical: number | null;
  status: ObservationStatus | null;
  created_at: string;
}

// Aggregated observation for cards view
export interface ObservationSummary {
  obs_code: string;
  obs_name: string;
  catalog_id: string | null;
  catalog_name_ru: string | null;
  catalog_name_en: string | null;
  canonical_unit: string | null;
  latest_value: number | null;
  latest_value_text: string | null;
  latest_unit: string | null;
  latest_status: ObservationStatus | null;
  latest_date: string | null;
  latest_ref_low: number | null;
  latest_ref_high: number | null;
  latest_ref_low_canonical: number | null;
  latest_ref_high_canonical: number | null;
  // Default reference ranges from catalog (used when specific ref range is not available)
  default_ref_low: number | null;
  default_ref_high: number | null;
  measurement_count: number;
  history: ObservationHistoryPoint[];
}
