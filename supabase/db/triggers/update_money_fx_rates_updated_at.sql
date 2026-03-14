-- Trigger: update_money_fx_rates_updated_at
-- Auto-update updated_at timestamp on money_fx_rates table

DROP TRIGGER IF EXISTS update_money_fx_rates_updated_at ON public.money_fx_rates;
CREATE TRIGGER update_money_fx_rates_updated_at
  BEFORE UPDATE ON public.money_fx_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
