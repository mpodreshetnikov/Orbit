-- Type: checkup_category
-- Checkup/follow-up categories

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checkup_category') THEN
    CREATE TYPE public.checkup_category AS ENUM (
      'lab',
      'imaging',
      'visit',
      'vaccination',
      'dental',
      'other'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.checkup_category ADD VALUE IF NOT EXISTS 'new_value';
