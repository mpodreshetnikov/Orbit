-- Trigger: update_med_dose_events_updated_at
-- Auto-update updated_at timestamp on med_dose_events table

DROP TRIGGER IF EXISTS update_med_dose_events_updated_at ON public.med_dose_events;
CREATE TRIGGER update_med_dose_events_updated_at
  BEFORE UPDATE ON public.med_dose_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
