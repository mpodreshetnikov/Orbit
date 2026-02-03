-- ============================================================================
-- Notification routing + per-person digests + prefix rules + legacy RPC cleanup
-- ============================================================================

-- ----------------------------------------------------------------------------
-- notification_routing: which recipient wants notifications for which person
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  custom_prefix text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_user_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_routing_recipient
  ON public.notification_routing(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notification_routing_person
  ON public.notification_routing(person_id);

CREATE TRIGGER update_notification_routing_updated_at
  BEFORE UPDATE ON public.notification_routing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.notification_routing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notification_routing"
  ON public.notification_routing FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY "Users can insert own notification_routing"
  ON public.notification_routing FOR INSERT TO authenticated
  WITH CHECK (recipient_user_id = auth.uid());

CREATE POLICY "Users can update own notification_routing"
  ON public.notification_routing FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

CREATE POLICY "Users can delete own notification_routing"
  ON public.notification_routing FOR DELETE TO authenticated
  USING (recipient_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- notification_digests: add person_id for per-person notifications
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_digests
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.persons(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notification_digests_auth_person_type_scheduled
  ON public.notification_digests(auth_user_id, person_id, type, scheduled_at);

COMMENT ON COLUMN public.notification_digests.person_id IS
  'Person this digest is about. Null for global notifications.';

-- ----------------------------------------------------------------------------
-- Helper: routed persons for a recipient (explicit routing + implicit own person)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_routed_persons_for_recipient(uuid);

CREATE OR REPLACE FUNCTION public.get_routed_persons_for_recipient(
  p_recipient_user_id uuid
)
RETURNS TABLE (
  person_id uuid,
  person_name text,
  custom_prefix text,
  person_owner_user_id uuid
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.person_id, p.name, r.custom_prefix, p.auth_user_id
  FROM public.notification_routing r
  JOIN public.persons p ON p.id = r.person_id
  WHERE r.recipient_user_id = p_recipient_user_id
    AND r.enabled = true
  UNION ALL
  SELECT p.id, p.name, NULL::text, p.auth_user_id
  FROM public.persons p
  WHERE p.auth_user_id = p_recipient_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_routing r2
      WHERE r2.recipient_user_id = p_recipient_user_id
        AND r2.person_id = p.id
    );
$$;

COMMENT ON FUNCTION public.get_routed_persons_for_recipient(uuid) IS
  'Returns enabled routed persons for recipient_user_id, plus implicit own person if no explicit routing row exists.';

-- ----------------------------------------------------------------------------
-- Checkups: payload for a single person
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_checkup_notification_payload_for_person(
  p_person_id uuid,
  p_date date,
  p_notification_time time,
  p_timezone text
)
RETURNS TABLE (
  person_id uuid,
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

  v_overdue_titles := ARRAY[]::text[];
  v_reminder_titles := ARRAY[]::text[];

  -- Overdue: active items where next_due_at < p_date OR (planned_on IS NOT NULL AND planned_on < p_date)
  FOR v_item IN
    SELECT ci.id, ci.title, ci.next_due_at, ci.planned_on
    FROM public.checkup_items ci
    WHERE ci.person_id = p_person_id
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
    WHERE ci.person_id = p_person_id
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

  person_id := p_person_id;
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

COMMENT ON FUNCTION public.get_checkup_notification_payload_for_person(uuid, date, time, text) IS
  'Returns one row for a single person when there are overdue and/or reminder checkups.';

-- ----------------------------------------------------------------------------
-- Medication: payload for a single person (due + overdue)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_medication_dose_reminder_payload_for_person(
  p_person_id uuid,
  p_now_timestamptz timestamptz,
  p_timezone text DEFAULT NULL
)
RETURNS TABLE (
  scheduled_at timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  title text,
  body text,
  url text,
  dose_event_id uuid,
  medication_name text,
  amount text,
  unit text,
  time_str text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_today_start timestamptz;
  v_today_end timestamptz;
BEGIN
  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
  v_today_start := ((p_now_timestamptz AT TIME ZONE v_tz)::date)::timestamp AT TIME ZONE v_tz;
  v_today_end := v_today_start + interval '1 day';

  RETURN QUERY
  SELECT
    e.actual_at,
    date_trunc('minute', e.actual_at),
    date_trunc('minute', e.actual_at) + interval '1 minute',
    'Medications'::text,
    (
      '• ' || r.custom_name
      || E'\n  '
      || COALESCE(e.planned_intake->'intake'->>'amount', '1')
      || ' '
      || COALESCE(NULLIF(trim(COALESCE(e.planned_intake->'intake'->>'unit', '')), ''), 'pill')
      || ' · '
      || to_char(e.actual_at AT TIME ZONE v_tz, 'HH24:MI')
    )::text,
    '/health/medications'::text,
    e.id,
    r.custom_name::text,
    COALESCE(e.planned_intake->'intake'->>'amount', '1')::text,
    COALESCE(NULLIF(trim(COALESCE(e.planned_intake->'intake'->>'unit', '')), ''), 'pill')::text,
    to_char(e.actual_at AT TIME ZONE v_tz, 'HH24:MI')::text
  FROM public.med_dose_events e
  JOIN public.med_regimens r ON r.id = e.regimen_id
  WHERE e.person_id = p_person_id
    AND e.status IN ('scheduled', 'sent')
    AND (
      (e.actual_at >= p_now_timestamptz - interval '1 minute' AND e.actual_at < p_now_timestamptz + interval '1 minute')
      OR (e.actual_at < p_now_timestamptz AND e.actual_at >= v_today_start AND e.actual_at < v_today_end)
    )
  ORDER BY e.actual_at;
END;
$$;

COMMENT ON FUNCTION public.get_medication_dose_reminder_payload_for_person(uuid, timestamptz, text) IS
  'Return dose events for one person due in 1-min window or overdue for today.';

-- ----------------------------------------------------------------------------
-- Medication: reminder digests per recipient + person
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_medication_reminder_digests(
  p_now_timestamptz timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_route record;
  v_row record;
  v_tz text;
  v_interval_min int;
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_in_due_window boolean;
  v_overdue_today boolean;
  v_last_sent timestamptz;
  v_ref timestamptz;
  v_exists boolean;
  v_doses jsonb;
  v_min_scheduled timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_prefix text;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT r.recipient_user_id AS auth_user_id
    FROM public.notification_routing r
    UNION
    SELECT DISTINCT p.auth_user_id
    FROM public.persons p
    WHERE p.auth_user_id IS NOT NULL
  LOOP
    SELECT
      COALESCE(NULLIF(TRIM(up.checkup_notification_timezone), ''), 'UTC'),
      COALESCE(NULLIF(up.overdue_reminder_interval_minutes, 0), 30)
    INTO v_tz, v_interval_min
    FROM public.user_preferences up
    WHERE up.auth_user_id = v_rec.auth_user_id;

    v_tz := COALESCE(NULLIF(TRIM(v_tz), ''), 'UTC');
    v_interval_min := GREATEST(1, v_interval_min);
    v_today_start := ((p_now_timestamptz AT TIME ZONE v_tz)::date)::timestamp AT TIME ZONE v_tz;
    v_today_end := v_today_start + interval '1 day';

    FOR v_route IN
      SELECT *
      FROM public.get_routed_persons_for_recipient(v_rec.auth_user_id)
    LOOP
      v_doses := '[]'::jsonb;
      v_min_scheduled := NULL;
      v_window_start := NULL;
      v_window_end := NULL;
      IF v_route.person_owner_user_id = v_rec.auth_user_id THEN
        v_prefix := NULL;
      ELSE
        v_prefix := COALESCE(NULLIF(TRIM(v_route.custom_prefix), ''), v_route.person_name);
      END IF;

      FOR v_row IN
        SELECT *
        FROM public.get_medication_dose_reminder_payload_for_person(
          v_route.person_id,
          p_now_timestamptz,
          v_tz
        )
      LOOP
        v_in_due_window := (
          v_row.scheduled_at >= p_now_timestamptz - interval '1 minute'
          AND v_row.scheduled_at < p_now_timestamptz + interval '1 minute'
        );
        v_overdue_today := (
          v_row.scheduled_at < p_now_timestamptz
          AND (v_row.scheduled_at AT TIME ZONE v_tz)::date = (p_now_timestamptz AT TIME ZONE v_tz)::date
        );

        IF v_in_due_window THEN
          SELECT EXISTS (
            SELECT 1
            FROM public.notification_digests d
            WHERE d.auth_user_id = v_rec.auth_user_id
              AND d.person_id = v_route.person_id
              AND d.type = 'medication'
              AND d.sent_at IS NULL
              AND (
                (d.payload_json->>'dose_event_id') = v_row.dose_event_id::text
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(COALESCE(d.payload_json->'doses', '[]'::jsonb)) AS dose
                  WHERE dose->>'dose_event_id' = v_row.dose_event_id::text
                )
              )
          ) INTO v_exists;
          IF NOT v_exists THEN
            v_doses := v_doses || jsonb_build_array(jsonb_build_object(
              'dose_event_id', v_row.dose_event_id::text,
              'medication_name', v_row.medication_name,
              'amount', v_row.amount,
              'unit', v_row.unit,
              'time_str', v_row.time_str,
              'body', v_row.body,
              'is_overdue_reminder', false
            ));
            IF v_min_scheduled IS NULL OR v_row.scheduled_at < v_min_scheduled THEN
              v_min_scheduled := v_row.scheduled_at;
              v_window_start := v_row.window_start;
              v_window_end := v_row.window_end;
            END IF;
          END IF;
          CONTINUE;
        END IF;

        IF v_overdue_today THEN
          SELECT max(d.sent_at) INTO v_last_sent
          FROM public.notification_digests d
          WHERE d.auth_user_id = v_rec.auth_user_id
            AND d.person_id = v_route.person_id
            AND d.type = 'medication'
            AND d.sent_at IS NOT NULL
            AND (
              (d.payload_json->>'dose_event_id') = v_row.dose_event_id::text
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(d.payload_json->'doses', '[]'::jsonb)) AS dose
                WHERE dose->>'dose_event_id' = v_row.dose_event_id::text
              )
            );
          v_ref := COALESCE(v_last_sent, v_row.scheduled_at);
          IF p_now_timestamptz >= v_ref + (v_interval_min || ' minutes')::interval THEN
            SELECT EXISTS (
              SELECT 1
              FROM public.notification_digests d
              WHERE d.auth_user_id = v_rec.auth_user_id
                AND d.person_id = v_route.person_id
                AND d.type = 'medication'
                AND d.sent_at IS NULL
                AND (
                  (d.payload_json->>'dose_event_id') = v_row.dose_event_id::text
                  OR EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(d.payload_json->'doses', '[]'::jsonb)) AS dose
                    WHERE dose->>'dose_event_id' = v_row.dose_event_id::text
                )
              )
            ) INTO v_exists;
            IF NOT v_exists THEN
              v_doses := v_doses || jsonb_build_array(jsonb_build_object(
                'dose_event_id', v_row.dose_event_id::text,
                'medication_name', v_row.medication_name,
                'amount', v_row.amount,
                'unit', v_row.unit,
                'time_str', v_row.time_str,
                'body', v_row.body,
                'is_overdue_reminder', true
              ));
              IF v_min_scheduled IS NULL OR v_row.scheduled_at < v_min_scheduled THEN
                v_min_scheduled := v_row.scheduled_at;
                v_window_start := v_row.window_start;
                v_window_end := v_row.window_end;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;

      IF jsonb_array_length(v_doses) > 0 AND v_min_scheduled IS NOT NULL THEN
        INSERT INTO public.notification_digests (
          auth_user_id,
          person_id,
          type,
          scheduled_at,
          window_start,
          window_end,
          payload_json
        ) VALUES (
          v_rec.auth_user_id,
          v_route.person_id,
          'medication',
          v_min_scheduled,
          v_window_start,
          v_window_end,
          jsonb_build_object(
            'title', 'Medications',
            'body', '',
            'url', '/health/medications',
            'doses', v_doses,
            'person_id', v_route.person_id,
            'person_name', v_route.person_name,
            'title_prefix', v_prefix
          )
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.create_medication_reminder_digests IS
  'Create one notification_digest per recipient+person with payload.doses = [ all due/overdue doses ]. Uses routing + implicit own person.';

-- ----------------------------------------------------------------------------
-- Medication: refill digests per recipient + person
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_medication_refill_digests(p_auth_user_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_ids uuid[];
  v_today date;
  v_inserted int := 0;
  v_reg record;
  v_rec record;
  v_prefix text;
BEGIN
  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_today := (now() AT TIME ZONE 'UTC')::date;

  FOR v_reg IN
    SELECT r.id, r.custom_name, r.inventory, r.person_id, p.name AS person_name, p.auth_user_id AS person_owner_user_id
    FROM public.med_regimens r
    JOIN public.persons p ON p.id = r.person_id
    WHERE r.person_id = ANY(v_person_ids)
      AND r.status = 'active'
      AND r.inventory IS NOT NULL
      AND (r.inventory->>'enabled')::boolean IS TRUE
      AND (r.inventory->>'current_amount')::numeric IS NOT NULL
      AND (r.inventory->>'refill_threshold_amount')::numeric IS NOT NULL
      AND (r.inventory->>'current_amount')::numeric <= (r.inventory->>'refill_threshold_amount')::numeric
  LOOP
    FOR v_rec IN
      SELECT r.recipient_user_id, r.custom_prefix, v_reg.person_name AS person_name, v_reg.person_owner_user_id AS person_owner_user_id
      FROM public.notification_routing r
      WHERE r.person_id = v_reg.person_id
        AND r.enabled = true
      UNION ALL
      SELECT p.auth_user_id AS recipient_user_id, NULL::text AS custom_prefix, v_reg.person_name AS person_name, v_reg.person_owner_user_id AS person_owner_user_id
      FROM public.persons p
      WHERE p.id = v_reg.person_id
        AND p.auth_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.notification_routing r2
          WHERE r2.recipient_user_id = p.auth_user_id
            AND r2.person_id = p.id
        )
    LOOP
      IF v_rec.person_owner_user_id = v_rec.recipient_user_id THEN
        v_prefix := NULL;
      ELSE
        v_prefix := COALESCE(NULLIF(TRIM(v_rec.custom_prefix), ''), v_rec.person_name);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.notification_digests d
        WHERE d.auth_user_id = v_rec.recipient_user_id
          AND d.person_id = v_reg.person_id
          AND d.type = 'medication_refill'
          AND (d.payload_json->>'regimen_id') = v_reg.id::text
          AND d.scheduled_at::date = v_today
          AND d.sent_at IS NULL
      ) THEN
        INSERT INTO public.notification_digests (
          auth_user_id,
          person_id,
          type,
          scheduled_at,
          payload_json
        ) VALUES (
          v_rec.recipient_user_id,
          v_reg.person_id,
          'medication_refill',
          now(),
          jsonb_build_object(
            'title', 'Medications',
            'body', 'Low stock: ' || v_reg.custom_name,
            'url', '/health/medications',
            'regimen_id', v_reg.id,
            'person_id', v_reg.person_id,
            'person_name', v_reg.person_name,
            'title_prefix', v_prefix
          )
        );
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.create_medication_refill_digests IS
  'Create refill notification_digests for low-stock regimens for all routed recipients (including implicit own person).';

-- ----------------------------------------------------------------------------
-- Medication: snooze digest should include person_id + prefix
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snooze_dose(
  p_dose_event_id uuid,
  p_auth_user_id uuid,
  p_minutes_from_now int DEFAULT 15
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
  v_new_actual_at timestamptz;
  v_title text;
  v_body text;
  v_url text := '/health/medications';
  v_person_name text;
  v_person_owner_user_id uuid;
  v_prefix text;
BEGIN
  SELECT e.id, e.regimen_id, e.actual_at, e.planned_intake, r.custom_name, e.person_id, p.name, p.auth_user_id
  INTO v_event
  FROM public.med_dose_events e
  JOIN public.med_regimens r ON r.id = e.regimen_id
  JOIN public.persons p ON p.id = e.person_id
  WHERE e.id = p_dose_event_id AND e.status IN ('scheduled', 'sent', 'snoozed');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_new_actual_at := now() + (p_minutes_from_now || ' minutes')::interval;

  UPDATE public.med_dose_events
  SET actual_at = v_new_actual_at, status = 'snoozed', updated_at = now()
  WHERE id = p_dose_event_id;

  v_title := 'Medications';
  v_body := v_event.custom_name || ' (' || COALESCE(v_event.planned_intake->'intake'->>'amount', '1') || ' ' || COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill') || ')';
  v_person_name := v_event.name;
  v_person_owner_user_id := v_event.auth_user_id;

  IF v_person_owner_user_id = p_auth_user_id THEN
    v_prefix := NULL;
  ELSE
    SELECT COALESCE(NULLIF(TRIM(r.custom_prefix), ''), v_person_name)
    INTO v_prefix
    FROM public.notification_routing r
    WHERE r.recipient_user_id = p_auth_user_id
      AND r.person_id = v_event.person_id;

    v_prefix := COALESCE(v_prefix, v_person_name);
  END IF;

  INSERT INTO public.notification_digests (
    auth_user_id,
    person_id,
    type,
    scheduled_at,
    window_start,
    window_end,
    payload_json
  )
  VALUES (
    p_auth_user_id,
    v_event.person_id,
    'medication_snoozed',
    v_new_actual_at,
    date_trunc('minute', v_new_actual_at),
    date_trunc('minute', v_new_actual_at) + interval '1 minute',
    jsonb_build_object(
      'title', v_title,
      'body', v_body,
      'url', v_url,
      'dose_event_id', p_dose_event_id,
      'person_id', v_event.person_id,
      'person_name', v_person_name,
      'title_prefix', v_prefix
    )
  );
END;
$$;

COMMENT ON FUNCTION public.snooze_dose IS 'Snooze dose: update actual_at and create medication_snoozed digest with person metadata.';

-- ----------------------------------------------------------------------------
-- Drop legacy notification RPCs (replaced by per-person versions)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_checkup_notification_payload(uuid, date, time, text);
DROP FUNCTION IF EXISTS public.get_medication_dose_reminder_payload(uuid, timestamptz, text);
