-- Scope transaction identity to the person the transaction belongs to.
--
-- Both uniqueness keys were global. Two people importing from the same bank shared one namespace:
-- an external_id or a dedupe hash colliding across people made `insertOrResolveTransaction` treat
-- one person's operation as a duplicate of another's and overwrite it, reporting a harmless
-- "skipped". `payer_person_id` is a reporting dimension in this app, not a security boundary, but it
-- is still the level at which an operation is one operation.

DROP INDEX IF EXISTS public.idx_money_transactions_source_external_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_money_transactions_person_source_external_id
  ON public.money_transactions(payer_person_id, source, external_id)
  WHERE external_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_money_transactions_dedupe_hash;

CREATE UNIQUE INDEX IF NOT EXISTS idx_money_transactions_person_dedupe_hash
  ON public.money_transactions(payer_person_id, dedupe_hash)
  WHERE dedupe_hash IS NOT NULL;

-- Adoption looks for statement transactions of one person, on one account, with no external_id,
-- around a given instant and amount. Without this index that is a sequential scan per imported row.
CREATE INDEX IF NOT EXISTS idx_money_transactions_adoption_candidates
  ON public.money_transactions(payer_person_id, account_id, posted_at)
  WHERE external_id IS NULL;
