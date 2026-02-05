-- Trigger: update_measurements_updated_at
-- Auto-update updated_at timestamp on measurements table

DROP TRIGGER IF EXISTS update_measurements_updated_at ON public.measurements;
CREATE TRIGGER update_measurements_updated_at
  BEFORE UPDATE ON public.measurements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
