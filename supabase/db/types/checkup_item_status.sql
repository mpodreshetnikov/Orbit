-- Type: checkup_item_status
-- Checkup item statuses

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checkup_item_status') THEN
    CREATE TYPE public.checkup_item_status AS ENUM (
      'active',
      'paused',
      'completed',
      'archived'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.checkup_item_status ADD VALUE IF NOT EXISTS 'new_value';
