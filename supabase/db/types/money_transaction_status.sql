-- Type: money_transaction_status
-- Money transaction statuses

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'money_transaction_status') THEN
    CREATE TYPE public.money_transaction_status AS ENUM (
      'posted',
      'pending',
      'cancelled'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.money_transaction_status ADD VALUE IF NOT EXISTS 'new_value';
