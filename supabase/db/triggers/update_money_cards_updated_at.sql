-- Trigger: update_money_cards_updated_at
-- Auto-update updated_at timestamp on money_cards table

DROP TRIGGER IF EXISTS update_money_cards_updated_at ON public.money_cards;
CREATE TRIGGER update_money_cards_updated_at
  BEFORE UPDATE ON public.money_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
