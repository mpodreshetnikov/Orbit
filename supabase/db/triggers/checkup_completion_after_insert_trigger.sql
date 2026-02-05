-- Trigger: checkup_completion_after_insert_trigger
-- Update checkup item after completion is inserted

DROP TRIGGER IF EXISTS checkup_completion_after_insert_trigger ON public.checkup_completions;
CREATE TRIGGER checkup_completion_after_insert_trigger
  AFTER INSERT ON public.checkup_completions
  FOR EACH ROW EXECUTE FUNCTION public.checkup_completion_after_insert();
