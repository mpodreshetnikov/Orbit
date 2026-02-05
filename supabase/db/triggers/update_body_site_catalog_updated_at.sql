-- Trigger: update_body_site_catalog_updated_at
-- Auto-update updated_at timestamp on body_site_catalog table

DROP TRIGGER IF EXISTS update_body_site_catalog_updated_at ON public.body_site_catalog;
CREATE TRIGGER update_body_site_catalog_updated_at
  BEFORE UPDATE ON public.body_site_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
