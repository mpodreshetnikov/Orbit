-- Trigger: update_finding_type_catalog_updated_at
-- Auto-update updated_at timestamp on finding_type_catalog table

DROP TRIGGER IF EXISTS update_finding_type_catalog_updated_at ON public.finding_type_catalog;
CREATE TRIGGER update_finding_type_catalog_updated_at
  BEFORE UPDATE ON public.finding_type_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
