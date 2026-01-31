-- Add window_start and window_end to notification_digests for deduplication.
-- For checkups: 24h window per date; do not create a new digest if one already exists in the same window (resend existing until user receives).

ALTER TABLE public.notification_digests
  ADD COLUMN IF NOT EXISTS window_start timestamptz,
  ADD COLUMN IF NOT EXISTS window_end timestamptz;

CREATE INDEX IF NOT EXISTS idx_notification_digests_window_unsent
  ON public.notification_digests(auth_user_id, type)
  WHERE sent_at IS NULL AND window_start IS NOT NULL AND window_end IS NOT NULL;

COMMENT ON COLUMN public.notification_digests.window_start IS 'Start of the notification window (e.g. start of day for checkups). Used to avoid creating duplicate digests in the same window.';
COMMENT ON COLUMN public.notification_digests.window_end IS 'End of the notification window (e.g. end of day for checkups).';

-- Update RPC to return window_start, window_end for checkup provider (24h window).
CREATE OR REPLACE FUNCTION public.get_checkup_notification_payload(
  p_auth_user_id uuid,
  p_date date,
  p_notification_time time,
  p_timezone text
)
RETURNS TABLE (
  scheduled_at timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  title text,
  body text,
  url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_ids uuid[];
  v_titles text[];
  v_scheduled_at timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_today date;
  v_yesterday date;
  v_item record;
  v_reminder_days integer[];
  v_days_before int;
  v_due date;
  v_include boolean;
BEGIN
  v_today := p_date;
  v_yesterday := v_today - interval '1 day';

  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons
  WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  v_titles := ARRAY[]::text[];

  FOR v_item IN
    SELECT ci.id, ci.title, ci.next_due_at, ci.reminder_days_before, ci.planned_on
    FROM public.checkup_items ci
    WHERE ci.person_id = ANY(v_person_ids)
      AND ci.status = 'active'
      AND ci.next_due_at IS NOT NULL
  LOOP
    v_include := false;
    v_due := v_item.next_due_at::date;

    IF v_item.planned_on IS NOT NULL AND v_item.planned_on >= v_today THEN
      CONTINUE;
    END IF;

    IF v_item.planned_on IS NOT NULL AND v_item.planned_on = v_yesterday THEN
      v_include := true;
    ELSE
      IF v_due = v_today THEN
        v_include := true;
      END IF;
      v_reminder_days := COALESCE(v_item.reminder_days_before, ARRAY[]::integer[]);
      FOREACH v_days_before IN ARRAY v_reminder_days LOOP
        IF (v_due - (v_days_before || ' days')::interval)::date = v_today THEN
          v_include := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_include THEN
      v_titles := array_append(v_titles, v_item.title);
    END IF;
  END LOOP;

  IF array_length(v_titles, 1) IS NULL THEN
    RETURN;
  END IF;

  v_scheduled_at := ((v_today::text || ' ' || p_notification_time::text)::timestamp AT TIME ZONE COALESCE(NULLIF(trim(p_timezone), ''), 'UTC'));
  v_window_start := ((v_today::text || ' 00:00:00')::timestamp AT TIME ZONE COALESCE(NULLIF(trim(p_timezone), ''), 'UTC'));
  v_window_end := (((v_today + interval '1 day')::date)::text || ' 00:00:00')::timestamp AT TIME ZONE COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');

  title := 'Checkups';
  body := array_to_string(v_titles, ', ');
  IF array_length(v_titles, 1) > 1 THEN
    body := body || ' — ' || array_length(v_titles, 1) || ' checkups to do or plan';
  ELSE
    body := body || ' — 1 checkup to do or plan';
  END IF;
  url := '/health/checkups';
  scheduled_at := v_scheduled_at;
  window_start := v_window_start;
  window_end := v_window_end;
  RETURN NEXT;
END;
$$;
