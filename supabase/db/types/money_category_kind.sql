-- Type: money_category_kind
-- Distinguishes built-in canonical categories from user-defined custom categories

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'money_category_kind') THEN
    CREATE TYPE public.money_category_kind AS ENUM (
      'canonical',
      'custom'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.money_category_kind ADD VALUE IF NOT EXISTS 'new_value';
