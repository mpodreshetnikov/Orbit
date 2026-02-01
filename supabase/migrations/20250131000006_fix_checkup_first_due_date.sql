-- ============================================================================
-- Fix: First due date for interval checkups: anchor_date when >= today;
-- when anchor_date is before today, advance by interval until first due >= today.
-- ============================================================================

-- On INSERT: when anchor_date is set, first next_due_at = anchor_date if >= today,
-- else first due in the series (anchor, anchor+interval, ...) that is >= today.
CREATE OR REPLACE FUNCTION public.checkup_item_set_next_due_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  s_type text;
  s_due_at text;
  base_date date;
  anchor_date date;
  next_due date;
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
    anchor_date := (NEW.schedule->>'anchor_date')::date;
    IF anchor_date IS NOT NULL THEN
      IF anchor_date >= current_date THEN
        NEW.next_due_at := anchor_date;
      ELSE
        -- Anchor in the past: advance by interval until first due >= today.
        base_date := anchor_date;
        next_due := anchor_date;
        LOOP
          IF next_due >= current_date THEN
            EXIT;
          END IF;
          base_date := next_due;
          next_due := public.checkup_compute_next_due(NEW.schedule, base_date);
          EXIT WHEN next_due IS NULL;
        END LOOP;
        NEW.next_due_at := next_due;
      END IF;
    ELSE
      base_date := current_date;
      NEW.next_due_at := public.checkup_compute_next_due(NEW.schedule, base_date);
    END IF;
  ELSE
    NEW.next_due_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Recompute: when no completions and anchor_date is set, next_due_at = anchor_date (not anchor + interval).
CREATE OR REPLACE FUNCTION public.checkup_recompute_next_due_for_item(
  p_checkup_item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_schedule jsonb;
  completion_count int;
  latest_done_at date;
  base_date date;
  next_due date;
  s_due_at text;
  anchor_date date;
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

    anchor_date := (item_schedule->>'anchor_date')::date;

    -- No completions yet: first due = anchor_date if >= today; if anchor in past, advance by interval until >= today.
    IF latest_done_at IS NULL THEN
      IF anchor_date IS NOT NULL THEN
        IF anchor_date >= current_date THEN
          next_due := anchor_date;
        ELSE
          base_date := anchor_date;
          next_due := anchor_date;
          LOOP
            IF next_due >= current_date THEN
              EXIT;
            END IF;
            base_date := next_due;
            next_due := public.checkup_compute_next_due(item_schedule, base_date);
            EXIT WHEN next_due IS NULL;
          END LOOP;
        END IF;
      ELSE
        base_date := current_date;
        next_due := public.checkup_compute_next_due(item_schedule, base_date);
      END IF;
      UPDATE public.checkup_items
      SET next_due_at = next_due,
          updated_at = now()
      WHERE id = p_checkup_item_id;
      RETURN;
    END IF;

    IF COALESCE(item_schedule->>'next_due_from', 'completion') = 'target'
       AND anchor_date IS NOT NULL
    THEN
      -- From target: find last occurrence (anchor + n*interval) <= latest_done_at, then next = that + interval
      base_date := anchor_date;
      LOOP
        next_due := public.checkup_compute_next_due(item_schedule, base_date);
        EXIT WHEN next_due IS NULL OR next_due > latest_done_at;
        base_date := next_due;
      END LOOP;
      next_due := public.checkup_compute_next_due(item_schedule, base_date);
    ELSE
      base_date := COALESCE(
        latest_done_at,
        anchor_date,
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
