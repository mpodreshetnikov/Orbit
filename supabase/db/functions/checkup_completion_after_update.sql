-- Function: checkup_completion_after_update()
-- Trigger function: recompute next_due_at after completion update

CREATE OR REPLACE FUNCTION public.checkup_completion_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.checkup_recompute_next_due_for_item(NEW.checkup_item_id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.checkup_completion_after_update() IS
  'Trigger function: after updating a completion (e.g. done_at changed), recompute item next_due_at.';
