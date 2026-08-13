-- Record which authenticated user an import batch belongs to.
--
-- Actions over a batch (apply, discard, brand resolution, card remap) checked only that the caller
-- was on the allowlist, then worked with any batch id under the service-role key. `complete_session`
-- and `session_status` already checked ownership, so the rule was applied inconsistently. RLS here
-- is allowlist-only by design, which makes this the only place the check can live.

ALTER TABLE public.money_import_batches
  ADD COLUMN IF NOT EXISTS created_by_auth_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_money_import_batches_created_by
  ON public.money_import_batches(created_by_auth_user_id);

-- Backfill from the session that created the batch, where there is one. A batch without a session
-- (a file upload from an older build) stays NULL and is treated as unowned: any allowed user may
-- act on it, exactly as today. New batches always carry the column.
UPDATE public.money_import_batches AS batch
SET created_by_auth_user_id = session.created_by_auth_user_id
FROM public.money_import_sessions AS session
WHERE session.id = batch.session_id
  AND batch.created_by_auth_user_id IS NULL
  AND session.created_by_auth_user_id IS NOT NULL;
