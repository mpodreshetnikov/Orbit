-- Budget reporting schema for the Money module.

CREATE TABLE IF NOT EXISTS public.money_budget_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.money_categories(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  target_amount numeric NOT NULL,
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT money_budget_targets_month_start_check
    CHECK (month_start = date_trunc('month', month_start)::date),
  CONSTRAINT money_budget_targets_currency_check
    CHECK (currency = upper(currency))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_money_budget_targets_person_category_month
  ON public.money_budget_targets(person_id, category_id, month_start);

CREATE INDEX IF NOT EXISTS idx_money_budget_targets_person_month
  ON public.money_budget_targets(person_id, month_start);

CREATE INDEX IF NOT EXISTS idx_money_budget_targets_category_month
  ON public.money_budget_targets(category_id, month_start);

CREATE TABLE IF NOT EXISTS public.money_transfer_self_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT money_transfer_self_aliases_alias_check
    CHECK (btrim(alias) <> ''),
  CONSTRAINT money_transfer_self_aliases_normalized_alias_check
    CHECK (btrim(normalized_alias) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_money_transfer_self_aliases_person_normalized
  ON public.money_transfer_self_aliases(person_id, normalized_alias);

CREATE INDEX IF NOT EXISTS idx_money_transfer_self_aliases_person_id
  ON public.money_transfer_self_aliases(person_id);

CREATE TABLE IF NOT EXISTS public.money_fx_rates (
  rate_date date NOT NULL,
  base_currency char(3) NOT NULL,
  quote_currency char(3) NOT NULL,
  rate numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT money_fx_rates_pkey PRIMARY KEY (rate_date, base_currency, quote_currency),
  CONSTRAINT money_fx_rates_currency_check
    CHECK (
      base_currency = upper(base_currency)
      AND quote_currency = upper(quote_currency)
      AND base_currency <> quote_currency
    ),
  CONSTRAINT money_fx_rates_rate_check
    CHECK (rate > 0)
);

CREATE INDEX IF NOT EXISTS idx_money_fx_rates_pair_date
  ON public.money_fx_rates(base_currency, quote_currency, rate_date DESC);

ALTER TABLE public.money_budget_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_transfer_self_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_fx_rates ENABLE ROW LEVEL SECURITY;
