-- Function: checkup_item_after_update()
-- Trigger function: recompute next_due_at after schedule change

CREATE OR REPLACE FUNCTION public.checkup_item_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.schedule IS DISTINCT FROM NEW.schedule THEN
    PERFORM public.checkup_recompute_next_due_for_item(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.checkup_item_after_update() IS
  'Trigger function: after updating a checkup item schedule, recompute next_due_at.';
