-- Function: checkup_completion_after_delete()
-- Trigger function: recompute next_due_at after completion delete

CREATE OR REPLACE FUNCTION public.checkup_completion_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.checkup_recompute_next_due_for_item(OLD.checkup_item_id);
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.checkup_completion_after_delete() IS
  'Trigger function: after deleting a completion, recompute item next_due_at (or restore one_off to active).';
