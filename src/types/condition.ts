// ============================================================================
// CONDITION TYPES (Two-table model)
// ============================================================================

export type ConditionStatus = "active" | "resolved" | "suspected" | "history";
export const CONDITION_STATUSES: ConditionStatus[] = ["active", "resolved", "suspected", "history"];

// ============================================================================
// CONDITIONS TABLE - The persistent entity
// ============================================================================

export interface Condition {
  id: string;
  person_id: string;
  name: string;
  icd_name_en: string | null;  // Official ICD name in English
  icd_name_ru: string | null;  // Official ICD name in Russian
  code: string | null;         // ICD-10 code (e.g., "D50.9")
  current_status: ConditionStatus;
  onset_date: string | null;
  resolved_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateConditionInput {
  person_id: string;
  name: string;
  icd_name_en?: string | null;
  icd_name_ru?: string | null;
  code?: string | null;
  current_status?: ConditionStatus;
  onset_date?: string | null;
  resolved_date?: string | null;
  notes?: string | null;
}

export interface UpdateConditionInput {
  name?: string;
  icd_name_en?: string | null;
  icd_name_ru?: string | null;
  code?: string | null;
  current_status?: ConditionStatus;
  onset_date?: string | null;
  resolved_date?: string | null;
  notes?: string | null;
}

// ============================================================================
// CONDITION_RECORDS TABLE - Mentions in documents
// ============================================================================

export interface ConditionRecord {
  id: string;
  condition_id: string;
  record_id: string;
  status_in_record: ConditionStatus;
  source_anchor: string | null;
  confidence: number | null;
  is_llm_extracted: boolean;
  is_user_verified: boolean;
  created_at: string;
}

// Extended type with condition details (from get_record_conditions function)
export interface ConditionRecordWithDetails extends ConditionRecord {
  condition_name: string;
  condition_icd_name_en: string | null;  // Official ICD name in English
  condition_icd_name_ru: string | null;  // Official ICD name in Russian
  condition_code: string | null;         // ICD-10 code
  condition_current_status: ConditionStatus;
  condition_onset_date: string | null;
  condition_resolved_date: string | null;
  condition_notes: string | null;
}

export interface CreateConditionRecordInput {
  condition_id: string;
  record_id: string;
  status_in_record: ConditionStatus;
  source_anchor?: string | null;
  confidence?: number | null;
  is_llm_extracted?: boolean;
  is_user_verified?: boolean;
}

export interface UpdateConditionRecordInput {
  status_in_record?: ConditionStatus;
  source_anchor?: string | null;
  is_user_verified?: boolean;
}

// ============================================================================
// EXTRACTION TYPES - LLM output format
// ============================================================================

export interface ExtractedCondition {
  existing_condition_id: string | null;  // ID if matching existing condition
  name: string;                           // Required for new, optional for existing
  icd_code: string | null;                // ICD-10 code extracted by LLM
  status: ConditionStatus;                // Status as stated in THIS document
  confidence: number;
  source_anchor: string | null;
}

// Existing condition passed to LLM for matching
export interface ExistingConditionContext {
  id: string;
  name: string;
  code: string | null;  // ICD-10 code
  current_status: ConditionStatus;
  onset_date: string | null;
  resolved_date: string | null;
}

// ============================================================================
// ICD LOOKUP TYPES
// ============================================================================

// Result from icd-lookup edge function
export interface IcdLookupResult {
  code: string;
  name_en: string | null;
  name_ru: string | null;
  found: boolean;
}

// ICD search result item
export interface IcdSearchResult {
  code: string;
  name: string;
}

// ============================================================================
// AGGREGATED VIEWS - For person conditions list
// ============================================================================

export interface ConditionHistoryPoint {
  id: string;                    // condition_record id
  record_id: string;
  record_date: string | null;    // From medical_records join
  record_title: string | null;   // From medical_records join
  status_in_record: ConditionStatus;
  source_anchor: string | null;
  created_at: string;
}

export interface ConditionWithHistory extends Condition {
  mention_count: number;
  first_mentioned_date: string | null;
  last_mentioned_date: string | null;
  history?: ConditionHistoryPoint[];
}
