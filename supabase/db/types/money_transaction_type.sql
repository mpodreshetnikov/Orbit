-- Type: money_transaction_type
-- Money transaction types

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'money_transaction_type') THEN
    CREATE TYPE public.money_transaction_type AS ENUM (
      'expense',
      'income',
      'transfer',
      'refund',
      'fee',
      'adjustment'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.money_transaction_type ADD VALUE IF NOT EXISTS 'new_value';
