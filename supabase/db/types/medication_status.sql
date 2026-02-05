-- Type: medication_status
-- Medication regimen statuses

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medication_status') THEN
    CREATE TYPE public.medication_status AS ENUM (
      'active',
      'paused',
      'completed',
      'archived'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.medication_status ADD VALUE IF NOT EXISTS 'new_value';
