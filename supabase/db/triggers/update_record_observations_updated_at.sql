-- Trigger: update_record_observations_updated_at
-- Auto-update updated_at timestamp on record_observations table

DROP TRIGGER IF EXISTS update_record_observations_updated_at ON public.record_observations;
CREATE TRIGGER update_record_observations_updated_at
  BEFORE UPDATE ON public.record_observations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
