ALTER TABLE public.money_transactions
  ADD COLUMN IF NOT EXISTS source_comment text,
  ADD COLUMN IF NOT EXISTS cashback_amount numeric,
  ADD COLUMN IF NOT EXISTS cashback_currency text;
