-- Add card_id to money_transactions to link imported transactions to money_cards
ALTER TABLE public.money_transactions
  ADD COLUMN card_id uuid REFERENCES public.money_cards(id) ON DELETE SET NULL;

CREATE INDEX idx_money_transactions_card_id ON public.money_transactions(card_id);
