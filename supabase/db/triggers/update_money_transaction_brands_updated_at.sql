-- Trigger: update_money_transaction_brands_updated_at
-- Auto-update updated_at timestamp on money_transaction_brands table

DROP TRIGGER IF EXISTS update_money_transaction_brands_updated_at ON public.money_transaction_brands;
CREATE TRIGGER update_money_transaction_brands_updated_at
  BEFORE UPDATE ON public.money_transaction_brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
