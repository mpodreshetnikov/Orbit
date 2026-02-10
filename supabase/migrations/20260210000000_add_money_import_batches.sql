-- ============================================================================
-- money_import_batches: track import batches for audit and dedupe
-- ============================================================================

CREATE TABLE public.money_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  payer_person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  import_type text NOT NULL DEFAULT 'file',
  file_path text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_money_import_batches_payer_person_id ON public.money_import_batches(payer_person_id);
CREATE INDEX idx_money_import_batches_created_at ON public.money_import_batches(created_at);

ALTER TABLE public.money_import_batches ENABLE ROW LEVEL SECURITY;
