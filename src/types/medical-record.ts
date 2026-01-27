export type RecordType =
  | "lab"
  | "visit"
  | "imaging"
  | "prescription"
  | "vaccination"
  | "vet"
  | "other";

export type RecordStatus = 
  | "draft"              // Initial state after upload
  | "ocr_processing"     // OCR in progress
  | "ocr_review"         // OCR complete, awaiting user review
  | "structuring"        // Structure extraction in progress
  | "structure_review"   // Structure complete, awaiting user review
  | "processing"         // Legacy: kept for backward compatibility
  | "active"             // Finalized record
  | "removed";           // Soft deleted

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
  llm_summary: string | null;
  llm_keywords: string[] | null;
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
  llm_keywords?: string[] | null;
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
  other: { en: "Other", ru: "Другое" },
};

export const RECORD_TYPES: RecordType[] = [
  "lab",
  "visit",
  "imaging",
  "prescription",
  "vaccination",
  "vet",
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
