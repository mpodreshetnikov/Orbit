// Measurement catalog category
export type MeasurementCategory = "basic" | "body" | "limbs" | "vital";

// Measurement catalog entry (standardized measurement types)
export interface MeasurementCatalog {
  id: string;
  code: string;
  name_ru: string;
  name_en: string;
  unit_ru: string;
  unit_en: string;
  category: MeasurementCategory;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Individual measurement record
export interface Measurement {
  id: string;
  person_id: string;
  catalog_id: string;
  value: number;
  measured_at: string;
  notes: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

// Measurement with joined catalog data
export interface MeasurementWithCatalog extends Measurement {
  catalog: MeasurementCatalog;
}

// Single measurement history point
export interface MeasurementHistoryPoint {
  id: string;
  value: number;
  measured_at: string;
  notes: string | null;
  created_at: string;
}

// Aggregated measurement summary for list view
export interface MeasurementSummary {
  code: string;
  catalog_id: string;
  name_ru: string;
  name_en: string;
  unit_ru: string;
  unit_en: string;
  category: MeasurementCategory;
  latest_value: number;
  latest_date: string;
  measurement_count: number;
  history: MeasurementHistoryPoint[];
}

// Input types for creating/updating measurements
export interface CreateMeasurementInput {
  person_id: string;
  catalog_id: string;
  value: number;
  measured_at?: string; // Defaults to now
  notes?: string | null;
}

export interface UpdateMeasurementInput {
  value?: number;
  measured_at?: string;
  notes?: string | null;
}

// Input types for catalog management
export interface CreateMeasurementCatalogInput {
  code: string;
  name_ru: string;
  name_en: string;
  unit_ru: string;
  unit_en: string;
  category: MeasurementCategory;
  sort_order?: number;
}

export interface UpdateMeasurementCatalogInput {
  code?: string;
  name_ru?: string;
  name_en?: string;
  unit_ru?: string;
  unit_en?: string;
  category?: MeasurementCategory;
  sort_order?: number;
}

// Category labels for UI
export const MEASUREMENT_CATEGORY_LABELS: Record<MeasurementCategory, { en: string; ru: string }> =
  {
    basic: { en: "Basic", ru: "Основные" },
    body: { en: "Body", ru: "Тело" },
    limbs: { en: "Limbs", ru: "Конечности" },
    vital: { en: "Vital", ru: "Состав тела" },
  };

export const MEASUREMENT_CATEGORIES: MeasurementCategory[] = ["basic", "body", "limbs", "vital"];
