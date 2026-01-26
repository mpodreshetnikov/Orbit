export type RecordType =
  | "lab"
  | "visit"
  | "imaging"
  | "prescription"
  | "vaccination"
  | "vet"
  | "other";

export type RecordStatus = "draft" | "active" | "removed";

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
  rank?: number;
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
