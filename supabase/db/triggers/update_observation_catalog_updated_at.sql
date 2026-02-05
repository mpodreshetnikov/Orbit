-- Trigger: update_observation_catalog_updated_at
-- Auto-update updated_at timestamp on observation_catalog table

DROP TRIGGER IF EXISTS update_observation_catalog_updated_at ON public.observation_catalog;
CREATE TRIGGER update_observation_catalog_updated_at
  BEFORE UPDATE ON public.observation_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
