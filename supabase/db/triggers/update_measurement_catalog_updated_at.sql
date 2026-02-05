-- Trigger: update_measurement_catalog_updated_at
-- Auto-update updated_at timestamp on measurement_catalog table

DROP TRIGGER IF EXISTS update_measurement_catalog_updated_at ON public.measurement_catalog;
CREATE TRIGGER update_measurement_catalog_updated_at
  BEFORE UPDATE ON public.measurement_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
