-- Trigger: set_money_transfer_self_aliases_normalized_alias
-- Normalizes money transfer self aliases before persistence.

DROP TRIGGER IF EXISTS set_money_transfer_self_aliases_normalized_alias ON public.money_transfer_self_aliases;
CREATE TRIGGER set_money_transfer_self_aliases_normalized_alias
  BEFORE INSERT OR UPDATE ON public.money_transfer_self_aliases
  FOR EACH ROW EXECUTE FUNCTION public.money_transfer_self_aliases_set_normalized_alias();
