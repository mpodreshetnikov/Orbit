-- Type: medication_unit
-- Medication intake units

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medication_unit') THEN
    CREATE TYPE public.medication_unit AS ENUM (
      'pill',
      'ml',
      'drops',
      'inhalation',
      'patch',
      'other',
      'iu',
      'ampoule',
      'capsule',
      'application',
      'gram',
      'injection',
      'milligram',
      'spray',
      'portion',
      'tablespoon',
      'teaspoon',
      'unit',
      'suppository'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.medication_unit ADD VALUE IF NOT EXISTS 'new_value';
