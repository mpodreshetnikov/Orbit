// Unit conversion configuration
export interface UnitConversion {
  factor_to_canonical?: number;
  formula_to_canonical?: string;
}

// Observation catalog entry
export interface ObservationCatalog {
  id: string;
  obs_code: string;
  name_ru: string;
  name_en: string;
  canonical_unit: string;
  synonyms_ru: string[];
  synonyms_en: string[];
  accepted_units: Record<string, UnitConversion>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Input for creating a new observation
export interface CreateObservationInput {
  obs_code: string;
  name_ru: string;
  name_en: string;
  canonical_unit: string;
  synonyms_ru?: string[];
  synonyms_en?: string[];
  accepted_units?: Record<string, UnitConversion>;
  notes?: string | null;
}

// Input for updating an observation
export interface UpdateObservationInput {
  obs_code?: string;
  name_ru?: string;
  name_en?: string;
  canonical_unit?: string;
  synonyms_ru?: string[];
  synonyms_en?: string[];
  accepted_units?: Record<string, UnitConversion>;
  notes?: string | null;
}
