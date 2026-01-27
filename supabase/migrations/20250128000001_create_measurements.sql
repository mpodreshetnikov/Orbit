-- ============================================================================
-- MEASUREMENT CATALOG TABLE
-- Standardized measurement types (height, weight, body measurements, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.measurement_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Unique code for the measurement type (e.g., "height", "weight", "chest")
  code text NOT NULL UNIQUE,
  
  -- Localized names
  name_ru text NOT NULL,
  name_en text NOT NULL,
  
  -- Localized units (metric system)
  unit_ru text NOT NULL,
  unit_en text NOT NULL,
  
  -- Category for grouping (body, limbs, vital)
  category text NOT NULL CHECK (category IN ('basic', 'body', 'limbs', 'vital')),
  
  -- Sort order within category
  sort_order int NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.measurement_catalog ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Authenticated users can read the catalog
CREATE POLICY "Authenticated users can read measurement catalog"
  ON public.measurement_catalog FOR SELECT TO authenticated
  USING (true);

-- RLS Policy: Allowed users can manage the catalog
CREATE POLICY "Allowed users can insert measurement catalog"
  ON public.measurement_catalog FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

CREATE POLICY "Allowed users can update measurement catalog"
  ON public.measurement_catalog FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

CREATE POLICY "Allowed users can delete measurement catalog"
  ON public.measurement_catalog FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_measurement_catalog_code 
  ON public.measurement_catalog(code);

CREATE INDEX IF NOT EXISTS idx_measurement_catalog_category 
  ON public.measurement_catalog(category, sort_order);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_measurement_catalog_updated_at
  BEFORE UPDATE ON public.measurement_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- MEASUREMENTS TABLE
-- Stores individual measurement values for persons
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to person being measured
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  
  -- Reference to measurement type
  catalog_id uuid NOT NULL REFERENCES public.measurement_catalog(id) ON DELETE RESTRICT,
  
  -- The measured value (numeric, in the unit specified in catalog)
  value numeric NOT NULL,
  
  -- When the measurement was taken (not when it was recorded)
  measured_at timestamptz NOT NULL DEFAULT now(),
  
  -- Optional notes
  notes text,
  
  -- Who recorded this measurement
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allowed users can read measurements
CREATE POLICY "Allowed users can read measurements"
  ON public.measurements FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- RLS Policy: Allowed users can insert measurements
CREATE POLICY "Allowed users can insert measurements"
  ON public.measurements FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- RLS Policy: Allowed users can update measurements
CREATE POLICY "Allowed users can update measurements"
  ON public.measurements FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- RLS Policy: Allowed users can delete measurements
CREATE POLICY "Allowed users can delete measurements"
  ON public.measurements FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_measurements_person_id 
  ON public.measurements(person_id);

CREATE INDEX IF NOT EXISTS idx_measurements_catalog_id 
  ON public.measurements(catalog_id);

CREATE INDEX IF NOT EXISTS idx_measurements_measured_at 
  ON public.measurements(measured_at DESC);

CREATE INDEX IF NOT EXISTS idx_measurements_person_catalog 
  ON public.measurements(person_id, catalog_id, measured_at DESC);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_measurements_updated_at
  BEFORE UPDATE ON public.measurements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- SEED DATA: Initial measurement catalog
-- ============================================================================

INSERT INTO public.measurement_catalog (code, name_ru, name_en, unit_ru, unit_en, category, sort_order)
VALUES
  -- Basic measurements
  ('height', 'Рост', 'Height', 'см', 'cm', 'basic', 1),
  ('weight', 'Вес', 'Weight', 'кг', 'kg', 'basic', 2),
  
  -- Body measurements
  ('neck', 'Обхват шеи', 'Neck circumference', 'см', 'cm', 'body', 1),
  ('shoulders', 'Ширина плеч', 'Shoulder width', 'см', 'cm', 'body', 2),
  ('chest', 'Обхват груди', 'Chest circumference', 'см', 'cm', 'body', 3),
  ('waist', 'Обхват талии', 'Waist circumference', 'см', 'cm', 'body', 4),
  ('hips', 'Обхват бёдер', 'Hip circumference', 'см', 'cm', 'body', 5),
  
  -- Limb measurements
  ('bicep_left', 'Бицепс левый', 'Left bicep', 'см', 'cm', 'limbs', 1),
  ('bicep_right', 'Бицепс правый', 'Right bicep', 'см', 'cm', 'limbs', 2),
  ('forearm_left', 'Предплечье левое', 'Left forearm', 'см', 'cm', 'limbs', 3),
  ('forearm_right', 'Предплечье правое', 'Right forearm', 'см', 'cm', 'limbs', 4),
  ('thigh_left', 'Бедро левое', 'Left thigh', 'см', 'cm', 'limbs', 5),
  ('thigh_right', 'Бедро правое', 'Right thigh', 'см', 'cm', 'limbs', 6),
  ('calf_left', 'Голень левая', 'Left calf', 'см', 'cm', 'limbs', 7),
  ('calf_right', 'Голень правая', 'Right calf', 'см', 'cm', 'limbs', 8),
  
  -- Vital/body composition
  ('body_fat', 'Процент жира', 'Body fat percentage', '%', '%', 'vital', 1),
  ('muscle_mass', 'Мышечная масса', 'Muscle mass', 'кг', 'kg', 'vital', 2),
  ('bmi', 'ИМТ', 'BMI', '', '', 'vital', 3)
ON CONFLICT (code) DO UPDATE SET
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  unit_ru = EXCLUDED.unit_ru,
  unit_en = EXCLUDED.unit_en,
  category = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
