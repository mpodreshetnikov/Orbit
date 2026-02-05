-- Type: record_status
-- Medical record statuses

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_status') THEN
    CREATE TYPE public.record_status AS ENUM (
      'draft',
      'active',
      'removed'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.record_status ADD VALUE IF NOT EXISTS 'new_value';
