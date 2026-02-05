-- Type: record_type
-- Medical record types

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_type') THEN
    CREATE TYPE public.record_type AS ENUM (
      'lab',
      'visit',
      'imaging',
      'prescription',
      'vaccination',
      'vet',
      'procedure',
      'other'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.record_type ADD VALUE IF NOT EXISTS 'new_value';
