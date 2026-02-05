-- Trigger: update_med_regimens_updated_at
-- Auto-update updated_at timestamp on med_regimens table

DROP TRIGGER IF EXISTS update_med_regimens_updated_at ON public.med_regimens;
CREATE TRIGGER update_med_regimens_updated_at
  BEFORE UPDATE ON public.med_regimens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
