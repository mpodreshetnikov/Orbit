ALTER TABLE public.money_import_batch_rows
  ADD COLUMN receipt_request_key text,
  ADD COLUMN receipt_enrichment_status text;

ALTER TABLE public.money_transactions
  ADD COLUMN receipt_request_key text,
  ADD COLUMN receipt_enrichment_status text;

CREATE INDEX idx_money_import_batch_rows_batch_receipt_status
  ON public.money_import_batch_rows(batch_id, receipt_enrichment_status);

CREATE INDEX idx_money_transactions_payer_receipt_status_source_posted_at
  ON public.money_transactions(payer_person_id, receipt_enrichment_status, source, posted_at);
