-- Money transactions: scope transaction identity to the person who paid.
--
-- Both identity indexes were global. Two people importing from the same bank shared one
-- namespace of external ids and dedupe hashes, so one person's operation could resolve to
-- the other's row — and the import path handles a unique violation by updating the row it
-- found and reporting a harmless-looking `skipped`.

DROP INDEX IF EXISTS idx_money_transactions_source_external_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_money_transactions_person_source_external_id
  ON public.money_transactions(payer_person_id, source, external_id)
  WHERE external_id IS NOT NULL;

DROP INDEX IF EXISTS idx_money_transactions_dedupe_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_money_transactions_person_dedupe_hash
  ON public.money_transactions(payer_person_id, dedupe_hash)
  WHERE dedupe_hash IS NOT NULL;

-- Adoption looks for a statement row with no external id, on the same account, for the same
-- amount, within a few days of the incoming operation.
CREATE INDEX IF NOT EXISTS idx_money_transactions_adoption_lookup
  ON public.money_transactions(payer_person_id, account_id, posted_at)
  WHERE external_id IS NULL;
