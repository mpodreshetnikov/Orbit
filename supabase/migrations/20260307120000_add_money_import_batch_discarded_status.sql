ALTER TABLE public.money_import_batches
  DROP CONSTRAINT IF EXISTS money_import_batches_status_check;

ALTER TABLE public.money_import_batches
  ADD CONSTRAINT money_import_batches_status_check
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'discarded'));
