-- Type: money_rule_kind
-- Ordered money category pipeline rule kinds.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'money_rule_kind') THEN
    CREATE TYPE public.money_rule_kind AS ENUM (
      'direct',
      'mcc_map',
      'llm_categorization',
      'fallback_uncategorized'
    );
  END IF;
END $$;
