-- Trigger: checkup_completion_after_update_trigger
-- Recompute checkup next_due_at after completion is updated

DROP TRIGGER IF EXISTS checkup_completion_after_update_trigger ON public.checkup_completions;
CREATE TRIGGER checkup_completion_after_update_trigger
  AFTER UPDATE ON public.checkup_completions
  FOR EACH ROW EXECUTE FUNCTION public.checkup_completion_after_update();
