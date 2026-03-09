CREATE TABLE public.money_import_batch_brand_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.money_import_batches(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_key text NOT NULL,
  source_name text NOT NULL,
  website_url text,
  logo_url text,
  base_color text,
  base_text_color text,
  suggested_brand_id uuid REFERENCES public.money_transaction_brands(id) ON DELETE SET NULL,
  suggested_confidence integer NOT NULL DEFAULT 0,
  suggested_reason text,
  selected_action text NOT NULL CHECK (selected_action IN ('match_existing', 'create_new')),
  selected_brand_id uuid REFERENCES public.money_transaction_brands(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_money_import_batch_brand_resolutions_batch_source_key
  ON public.money_import_batch_brand_resolutions(batch_id, source, source_key);

CREATE INDEX idx_money_import_batch_brand_resolutions_batch_id
  ON public.money_import_batch_brand_resolutions(batch_id);

ALTER TABLE public.money_import_batch_brand_resolutions ENABLE ROW LEVEL SECURITY;
