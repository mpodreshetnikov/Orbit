-- Trigger: update_money_transaction_brand_aliases_updated_at
-- Auto-update updated_at timestamp on money_transaction_brand_aliases table

DROP TRIGGER IF EXISTS update_money_transaction_brand_aliases_updated_at ON public.money_transaction_brand_aliases;
CREATE TRIGGER update_money_transaction_brand_aliases_updated_at
  BEFORE UPDATE ON public.money_transaction_brand_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
