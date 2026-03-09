CREATE TABLE public.money_transaction_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  website_url text,
  logo_url text,
  base_color text,
  base_text_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.money_transaction_brand_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.money_transaction_brands(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_key text NOT NULL,
  source_name text NOT NULL,
  website_url text,
  logo_url text,
  base_color text,
  base_text_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_money_transaction_brand_aliases_source_key
  ON public.money_transaction_brand_aliases(source, source_key);

CREATE INDEX idx_money_transaction_brand_aliases_brand_id
  ON public.money_transaction_brand_aliases(brand_id);

ALTER TABLE public.money_transactions
  ADD COLUMN brand_id uuid REFERENCES public.money_transaction_brands(id) ON DELETE SET NULL,
  ADD COLUMN operation_icon_url text,
  ADD COLUMN source_category_id text,
  ADD COLUMN source_category_name text;

CREATE INDEX idx_money_transactions_brand_id
  ON public.money_transactions(brand_id);

ALTER TABLE public.money_transaction_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_transaction_brand_aliases ENABLE ROW LEVEL SECURITY;
