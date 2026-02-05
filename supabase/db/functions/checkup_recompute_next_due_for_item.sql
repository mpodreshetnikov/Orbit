-- Function: checkup_recompute_next_due_for_item()
-- Recompute next_due_at for a checkup item based on current completions

CREATE OR REPLACE FUNCTION public.checkup_recompute_next_due_for_item(
  p_checkup_item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item_schedule jsonb;
  completion_count int;
  latest_done_at date;
  base_date date;
  next_due date;
  s_due_at text;
BEGIN
  SELECT schedule
  INTO item_schedule
  FROM public.checkup_items
  WHERE id = p_checkup_item_id;

  IF item_schedule IS NULL THEN
    RETURN;
  END IF;

  IF (item_schedule->>'type') = 'one_off' THEN
    SELECT count(*)
    INTO completion_count
    FROM public.checkup_completions
    WHERE checkup_item_id = p_checkup_item_id;

    s_due_at := item_schedule->>'due_at';
    IF completion_count >= 1 THEN
      UPDATE public.checkup_items
      SET status = 'completed',
          next_due_at = CASE WHEN s_due_at IS NOT NULL AND s_due_at != '' THEN s_due_at::date ELSE NULL END,
          updated_at = now()
      WHERE id = p_checkup_item_id;
    ELSE
      UPDATE public.checkup_items
      SET status = 'active',
          next_due_at = CASE WHEN s_due_at IS NOT NULL AND s_due_at != '' THEN s_due_at::date ELSE NULL END,
          updated_at = now()
      WHERE id = p_checkup_item_id;
    END IF;
    RETURN;
  END IF;

  IF (item_schedule->>'type') = 'interval' THEN
    SELECT max(done_at)
    INTO latest_done_at
    FROM public.checkup_completions
    WHERE checkup_item_id = p_checkup_item_id;

    IF COALESCE(item_schedule->>'next_due_from', 'completion') = 'target'
       AND (item_schedule->>'anchor_date') IS NOT NULL
       AND (item_schedule->>'anchor_date') != ''
       AND latest_done_at IS NOT NULL
    THEN
      -- From target: find last occurrence (anchor + n*interval) <= latest_done_at, then next = that + interval
      base_date := (item_schedule->>'anchor_date')::date;
      LOOP
        next_due := public.checkup_compute_next_due(item_schedule, base_date);
        EXIT WHEN next_due IS NULL OR next_due > latest_done_at;
        base_date := next_due;
      END LOOP;
      next_due := public.checkup_compute_next_due(item_schedule, base_date);
    ELSE
      base_date := COALESCE(
        latest_done_at,
        (item_schedule->>'anchor_date')::date,
        current_date
      );
      next_due := public.checkup_compute_next_due(item_schedule, base_date);
    END IF;

    UPDATE public.checkup_items
    SET next_due_at = next_due,
        updated_at = now()
    WHERE id = p_checkup_item_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.checkup_recompute_next_due_for_item(uuid) IS
  'Recompute next_due_at (and status for one_off) for a checkup item based on its current completions.';
