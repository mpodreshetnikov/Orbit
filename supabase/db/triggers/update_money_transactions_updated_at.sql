-- Trigger: update_money_transactions_updated_at
-- Auto-update updated_at timestamp on money_transactions table

DROP TRIGGER IF EXISTS update_money_transactions_updated_at ON public.money_transactions;
CREATE TRIGGER update_money_transactions_updated_at
  BEFORE UPDATE ON public.money_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
