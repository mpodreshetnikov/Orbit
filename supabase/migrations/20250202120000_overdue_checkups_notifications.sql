-- Include overdue checkups in notifications: overdue = next_due_at < today OR planned_on < today.
-- Build body with "Overdue: ..." and optional "Due today / reminders: ..."; send when only overdue or only reminders or both.

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
  v_overdue_titles text[];
  v_reminder_titles text[];
  v_scheduled_at timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_today date;
  v_yesterday date;
  v_item record;
  v_reminder_days integer[];
  v_days_before int;
  v_due date;
  v_include_reminder boolean;
  v_is_overdue boolean;
BEGIN
  v_today := p_date;
  v_yesterday := v_today - interval '1 day';

  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons
  WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  v_overdue_titles := ARRAY[]::text[];
  v_reminder_titles := ARRAY[]::text[];

  -- Overdue: active items where next_due_at < p_date OR (planned_on IS NOT NULL AND planned_on < p_date)
  FOR v_item IN
    SELECT ci.id, ci.title, ci.next_due_at, ci.planned_on
    FROM public.checkup_items ci
    WHERE ci.person_id = ANY(v_person_ids)
      AND ci.status = 'active'
      AND (
        (ci.next_due_at IS NOT NULL AND ci.next_due_at::date < v_today)
        OR (ci.planned_on IS NOT NULL AND ci.planned_on < v_today)
      )
  LOOP
    v_overdue_titles := array_append(v_overdue_titles, v_item.title);
  END LOOP;

  -- Reminders: due today, X days before due, or planned yesterday (exclude items already counted as overdue)
  FOR v_item IN
    SELECT ci.id, ci.title, ci.next_due_at, ci.reminder_days_before, ci.planned_on
    FROM public.checkup_items ci
    WHERE ci.person_id = ANY(v_person_ids)
      AND ci.status = 'active'
      AND ci.next_due_at IS NOT NULL
  LOOP
    v_is_overdue := (v_item.next_due_at::date < v_today)
      OR (v_item.planned_on IS NOT NULL AND v_item.planned_on < v_today);
    IF v_is_overdue THEN
      CONTINUE;
    END IF;

    IF v_item.planned_on IS NOT NULL AND v_item.planned_on >= v_today THEN
      CONTINUE;
    END IF;

    v_include_reminder := false;
    v_due := v_item.next_due_at::date;

    IF v_item.planned_on IS NOT NULL AND v_item.planned_on = v_yesterday THEN
      v_include_reminder := true;
    ELSE
      IF v_due = v_today THEN
        v_include_reminder := true;
      END IF;
      v_reminder_days := COALESCE(v_item.reminder_days_before, ARRAY[]::integer[]);
      FOREACH v_days_before IN ARRAY v_reminder_days LOOP
        IF (v_due - (v_days_before || ' days')::interval)::date = v_today THEN
          v_include_reminder := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_include_reminder THEN
      v_reminder_titles := array_append(v_reminder_titles, v_item.title);
    END IF;
  END LOOP;

  -- Return a row only if there is at least one overdue or one reminder
  IF (array_length(v_overdue_titles, 1) IS NULL AND array_length(v_reminder_titles, 1) IS NULL) THEN
    RETURN;
  END IF;

  v_scheduled_at := ((v_today::text || ' ' || p_notification_time::text)::timestamp AT TIME ZONE COALESCE(NULLIF(trim(p_timezone), ''), 'UTC'));
  v_window_start := ((v_today::text || ' 00:00:00')::timestamp AT TIME ZONE COALESCE(NULLIF(trim(p_timezone), ''), 'UTC'));
  v_window_end := (((v_today + interval '1 day')::date)::text || ' 00:00:00')::timestamp AT TIME ZONE COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');

  title := 'Checkups';
  url := '/health/checkups';
  scheduled_at := v_scheduled_at;
  window_start := v_window_start;
  window_end := v_window_end;

  -- Build body: explicit Overdue and optional Due today / reminders; each checkup on its own line
  IF array_length(v_overdue_titles, 1) IS NOT NULL AND array_length(v_reminder_titles, 1) IS NOT NULL THEN
    body := 'Overdue:' || E'\n' || array_to_string(v_overdue_titles, E'\n')
      || E'\n\nDue today / reminders:' || E'\n' || array_to_string(v_reminder_titles, E'\n');
    IF array_length(v_overdue_titles, 1) + array_length(v_reminder_titles, 1) > 1 THEN
      body := body || E'\n' || ' — ' || (array_length(v_overdue_titles, 1) + array_length(v_reminder_titles, 1)) || ' checkups to do or plan';
    ELSE
      body := body || E'\n' || ' — 1 checkup to do or plan';
    END IF;
  ELSIF array_length(v_overdue_titles, 1) IS NOT NULL THEN
    body := 'Overdue:' || E'\n' || array_to_string(v_overdue_titles, E'\n');
    IF array_length(v_overdue_titles, 1) > 1 THEN
      body := body || E'\n' || ' — ' || array_length(v_overdue_titles, 1) || ' overdue checkups';
    ELSE
      body := body || E'\n' || ' — 1 overdue checkup';
    END IF;
  ELSE
    body := array_to_string(v_reminder_titles, E'\n');
    IF array_length(v_reminder_titles, 1) > 1 THEN
      body := body || E'\n' || ' — ' || array_length(v_reminder_titles, 1) || ' checkups to do or plan';
    ELSE
      body := body || E'\n' || ' — 1 checkup to do or plan';
    END IF;
  END IF;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.get_checkup_notification_payload(uuid, date, time, text) IS
  'Returns one row when user has overdue and/or reminder checkups. Overdue = next_due_at < p_date OR planned_on < p_date. Body includes "Overdue: ..." and optional "Due today / reminders: ...".';
