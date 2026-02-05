-- Type: med_dose_event_status
-- Medication dose event statuses

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'med_dose_event_status') THEN
    CREATE TYPE public.med_dose_event_status AS ENUM (
      'scheduled',
      'sent',
      'taken',
      'skipped',
      'snoozed',
      'missed',
      'cancelled'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.med_dose_event_status ADD VALUE IF NOT EXISTS 'new_value';
