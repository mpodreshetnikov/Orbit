-- Type: med_intake_advice_type
-- Medication intake advice types

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'med_intake_advice_type') THEN
    CREATE TYPE public.med_intake_advice_type AS ENUM (
      'before_meal',
      'with_meal',
      'after_meal',
      'before_bed',
      'morning_fasting',
      'custom',
      'none'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.med_intake_advice_type ADD VALUE IF NOT EXISTS 'new_value';
