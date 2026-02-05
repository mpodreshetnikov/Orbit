-- Trigger: checkup_completion_after_delete_trigger
-- Recompute checkup next_due_at after completion is deleted

DROP TRIGGER IF EXISTS checkup_completion_after_delete_trigger ON public.checkup_completions;
CREATE TRIGGER checkup_completion_after_delete_trigger
  AFTER DELETE ON public.checkup_completions
  FOR EACH ROW EXECUTE FUNCTION public.checkup_completion_after_delete();
