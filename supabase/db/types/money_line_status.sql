-- Type: money_line_status
-- Money line item statuses

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'money_line_status') THEN
    CREATE TYPE public.money_line_status AS ENUM (
      'final',
      'returned',
      'cancelled'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.money_line_status ADD VALUE IF NOT EXISTS 'new_value';
