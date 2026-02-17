-- Trigger: update_money_accounts_updated_at
-- Auto-update updated_at timestamp on money_accounts table

DROP TRIGGER IF EXISTS update_money_accounts_updated_at ON public.money_accounts;
CREATE TRIGGER update_money_accounts_updated_at
  BEFORE UPDATE ON public.money_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
