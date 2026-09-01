-- Trigger: update_money_import_grants_updated_at
-- Auto-update updated_at timestamp on money_import_grants table

DROP TRIGGER IF EXISTS update_money_import_grants_updated_at ON public.money_import_grants;
CREATE TRIGGER update_money_import_grants_updated_at
  BEFORE UPDATE ON public.money_import_grants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
