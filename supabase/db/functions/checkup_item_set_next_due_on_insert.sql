-- Function: checkup_item_set_next_due_on_insert()
-- Trigger function: set next_due_at on INSERT

CREATE OR REPLACE FUNCTION public.checkup_item_set_next_due_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s_type text;
  s_due_at text;
  base_date date;
BEGIN
  s_type := NEW.schedule->>'type';
  IF s_type = 'one_off' THEN
    s_due_at := NEW.schedule->>'due_at';
    IF s_due_at IS NOT NULL AND s_due_at != '' THEN
      NEW.next_due_at := s_due_at::date;
    ELSE
      NEW.next_due_at := NULL;
    END IF;
  ELSIF s_type = 'interval' THEN
    base_date := COALESCE(
      (NEW.schedule->>'anchor_date')::date,
      current_date
    );
    NEW.next_due_at := public.checkup_compute_next_due(NEW.schedule, base_date);
  ELSE
    NEW.next_due_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.checkup_item_set_next_due_on_insert() IS
  'Trigger function: set next_due_at when inserting a checkup item based on schedule.';
