-- Function: checkup_completion_after_insert()
-- Trigger function: update item next_due_at or status after completion insert

CREATE OR REPLACE FUNCTION public.checkup_completion_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  item_schedule jsonb;
  item_status text;
  item_next_due_at date;
  next_due date;
  base_date date;
  next_due_from text;
BEGIN
  SELECT schedule, status::text, next_due_at
  INTO item_schedule, item_status, item_next_due_at
  FROM public.checkup_items
  WHERE id = NEW.checkup_item_id;

  IF item_schedule IS NULL THEN
    RETURN NEW;
  END IF;

  IF (item_schedule->>'type') = 'one_off' THEN
    UPDATE public.checkup_items
    SET status = 'completed', updated_at = now()
    WHERE id = NEW.checkup_item_id;
    RETURN NEW;
  END IF;

  IF (item_schedule->>'type') = 'interval' AND item_status = 'active' THEN
    next_due_from := COALESCE(item_schedule->>'next_due_from', 'completion');
    IF next_due_from = 'target' AND item_next_due_at IS NOT NULL THEN
      base_date := item_next_due_at;
    ELSE
      base_date := NEW.done_at;
    END IF;
    next_due := public.checkup_compute_next_due(item_schedule, base_date);
    UPDATE public.checkup_items
    SET next_due_at = next_due, updated_at = now()
    WHERE id = NEW.checkup_item_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.checkup_completion_after_insert() IS
  'Trigger function: after inserting a completion, update the checkup item (complete one_off or advance next_due_at for interval).';
