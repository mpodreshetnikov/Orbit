-- Trigger: update_medication_refill_snoozes_updated_at
-- Auto-update updated_at timestamp on medication_refill_snoozes table

DROP TRIGGER IF EXISTS update_medication_refill_snoozes_updated_at ON public.medication_refill_snoozes;
CREATE TRIGGER update_medication_refill_snoozes_updated_at
  BEFORE UPDATE ON public.medication_refill_snoozes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
