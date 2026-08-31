-- Money import batches: record who created the batch so batch actions can check ownership.
--
-- `apply_batch`, `discard_batch`, `update_brand_resolution` and `remap_preview_card` only
-- checked that the caller is an allowed user, then acted on whatever `batch_id` arrived,
-- under the service role key. `complete_session` and `session_status` did check ownership,
-- so the rule was applied inconsistently rather than deliberately dropped.

ALTER TABLE public.money_import_batches
  ADD COLUMN IF NOT EXISTS created_by_auth_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_money_import_batches_created_by_auth_user_id
  ON public.money_import_batches(created_by_auth_user_id);

COMMENT ON COLUMN public.money_import_batches.created_by_auth_user_id IS
  'Auth user that created the batch. Batch actions refuse a batch created by someone else.';

-- Batches created through an import session inherit their creator from it. File imports
-- predating this column keep NULL and stay reachable by any allowed user, which matches how
-- they behaved before; new file imports record their creator.
UPDATE public.money_import_batches AS batch
SET created_by_auth_user_id = session.created_by_auth_user_id
FROM public.money_import_sessions AS session
WHERE session.id = batch.session_id
  AND batch.created_by_auth_user_id IS NULL;
