-- Type: money_assignment_method
-- Money line item assignment methods

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'money_assignment_method') THEN
    CREATE TYPE public.money_assignment_method AS ENUM (
      'import',
      'rule',
      'llm',
      'manual'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.money_assignment_method ADD VALUE IF NOT EXISTS 'new_value';
