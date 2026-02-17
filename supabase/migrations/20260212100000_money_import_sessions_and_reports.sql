-- ============================================================================
-- Money import sessions + batch row reports + line-item idempotency
-- ============================================================================

CREATE TABLE public.money_import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  source text NOT NULL,
  payer_person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  created_by_auth_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'running', 'completed', 'failed', 'expired', 'revoked')),
  window_from timestamptz,
  window_to timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  batch_id uuid REFERENCES public.money_import_batches(id) ON DELETE SET NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_money_import_sessions_payer_person_id ON public.money_import_sessions(payer_person_id);
CREATE INDEX idx_money_import_sessions_created_by_auth_user_id ON public.money_import_sessions(created_by_auth_user_id);
CREATE INDEX idx_money_import_sessions_expires_at ON public.money_import_sessions(expires_at);

ALTER TABLE public.money_import_batches
  ADD COLUMN session_id uuid REFERENCES public.money_import_sessions(id) ON DELETE SET NULL,
  ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  ADD COLUMN window_from timestamptz,
  ADD COLUMN window_to timestamptz,
  ADD COLUMN parsed_through_at timestamptz,
  ADD COLUMN parsed_transactions_count integer NOT NULL DEFAULT 0,
  ADD COLUMN inserted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN skipped_count integer NOT NULL DEFAULT 0,
  ADD COLUMN error_count integer NOT NULL DEFAULT 0,
  ADD COLUMN completed_at timestamptz;

CREATE INDEX idx_money_import_batches_status ON public.money_import_batches(status);
CREATE INDEX idx_money_import_batches_session_id ON public.money_import_batches(session_id);

CREATE TABLE public.money_import_batch_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.money_import_batches(id) ON DELETE CASCADE,
  parent_row_id uuid REFERENCES public.money_import_batch_rows(id) ON DELETE CASCADE,
  row_kind text NOT NULL CHECK (row_kind IN ('transaction', 'line_item')),
  source_row_index integer NOT NULL,
  source_line_index integer,
  status text NOT NULL CHECK (status IN ('inserted', 'skipped', 'error')),
  message text,
  transaction_id uuid REFERENCES public.money_transactions(id) ON DELETE SET NULL,
  line_item_id uuid REFERENCES public.money_line_items(id) ON DELETE SET NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_money_import_batch_rows_batch_id ON public.money_import_batch_rows(batch_id);
CREATE INDEX idx_money_import_batch_rows_parent_row_id ON public.money_import_batch_rows(parent_row_id);
CREATE INDEX idx_money_import_batch_rows_ordering
  ON public.money_import_batch_rows(batch_id, source_row_index, source_line_index, created_at);

ALTER TABLE public.money_line_items
  ADD COLUMN import_hash text;

CREATE UNIQUE INDEX idx_money_line_items_tx_import_hash
  ON public.money_line_items(transaction_id, import_hash)
  WHERE import_hash IS NOT NULL;

ALTER TABLE public.money_import_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_import_batch_rows ENABLE ROW LEVEL SECURITY;
