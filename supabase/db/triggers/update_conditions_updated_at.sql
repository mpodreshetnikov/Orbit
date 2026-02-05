-- Trigger: update_conditions_updated_at
-- Auto-update updated_at timestamp on conditions table

DROP TRIGGER IF EXISTS update_conditions_updated_at ON public.conditions;
CREATE TRIGGER update_conditions_updated_at
  BEFORE UPDATE ON public.conditions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
