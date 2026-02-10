-- ============================================================================
-- money_cards: card last-4 (or mask) linked to an account for import mapping
-- ============================================================================
CREATE TABLE public.money_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.money_accounts(id) ON DELETE CASCADE,
  last4 text NOT NULL,
  card_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_money_cards_account_last4 ON public.money_cards(account_id, last4);
CREATE INDEX idx_money_cards_account_id ON public.money_cards(account_id);

ALTER TABLE public.money_cards ENABLE ROW LEVEL SECURITY;
