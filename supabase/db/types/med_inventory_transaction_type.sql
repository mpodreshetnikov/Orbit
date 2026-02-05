-- Type: med_inventory_transaction_type
-- Medication inventory transaction types

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'med_inventory_transaction_type') THEN
    CREATE TYPE public.med_inventory_transaction_type AS ENUM (
      'decrement',
      'refill',
      'set_absolute',
      'correction'
    );
  END IF;
END $$;

-- Enum evolution: add new values here
-- ALTER TYPE public.med_inventory_transaction_type ADD VALUE IF NOT EXISTS 'new_value';
