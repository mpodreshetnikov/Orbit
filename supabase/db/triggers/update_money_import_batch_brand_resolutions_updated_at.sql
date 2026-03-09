-- Trigger: update_money_import_batch_brand_resolutions_updated_at
-- Auto-update updated_at timestamp on money_import_batch_brand_resolutions table

DROP TRIGGER IF EXISTS update_money_import_batch_brand_resolutions_updated_at ON public.money_import_batch_brand_resolutions;
CREATE TRIGGER update_money_import_batch_brand_resolutions_updated_at
  BEFORE UPDATE ON public.money_import_batch_brand_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
