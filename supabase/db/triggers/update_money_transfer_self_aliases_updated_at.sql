-- Trigger: update_money_transfer_self_aliases_updated_at
-- Auto-update updated_at timestamp on money_transfer_self_aliases table

DROP TRIGGER IF EXISTS update_money_transfer_self_aliases_updated_at ON public.money_transfer_self_aliases;
CREATE TRIGGER update_money_transfer_self_aliases_updated_at
  BEFORE UPDATE ON public.money_transfer_self_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
