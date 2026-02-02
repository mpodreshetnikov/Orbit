-- ============================================================================
-- Medication reminder digests: one row per user + payload includes all doses
-- ============================================================================
-- 1) create_medication_reminder_digests: one digest per user with payload.doses
--    = [ all qualifying doses ]. Cron expands payload.doses so all doses are
--    sent in one notification. Backward compatible: cron supports old shape.
-- 2) get_medication_dose_reminder_payload: include status 'sent' (not only
--    'scheduled') so doses that had a notification sent still appear in
--    overdue reminders; add ORDER BY e.actual_at for deterministic order.
-- ============================================================================

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
BEGIN
  FOR v_rec IN
    SELECT DISTINCT p.auth_user_id
    FROM public.persons p
    JOIN public.med_regimens r ON r.person_id = p.id
      AND r.deleted_at IS NULL
      AND r.status = 'active'
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
    v_doses := '[]'::jsonb;
    v_min_scheduled := NULL;
    v_window_start := NULL;
    v_window_end := NULL;

    FOR v_row IN
      SELECT *
      FROM public.get_medication_dose_reminder_payload(
        v_rec.auth_user_id,
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
        type,
        scheduled_at,
        window_start,
        window_end,
        payload_json
      ) VALUES (
        v_rec.auth_user_id,
        'medication',
        v_min_scheduled,
        v_window_start,
        v_window_end,
        jsonb_build_object(
          'title', 'Medications',
          'body', '',
          'url', '/health/medications',
          'doses', v_doses
        )
      );
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.create_medication_reminder_digests IS
  'Create one notification_digest per user with payload.doses = [ all due/overdue doses ]. Ensures all doses (e.g. 2 from one med + 1 from another) are sent in one notification.';

-- ----------------------------------------------------------------------------
-- get_medication_dose_reminder_payload: include status 'sent', ORDER BY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_medication_dose_reminder_payload(
  p_auth_user_id uuid,
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
  v_person_ids uuid[];
  v_tz text;
  v_today_start timestamptz;
  v_today_end timestamptz;
BEGIN
  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
  v_today_start := ((p_now_timestamptz AT TIME ZONE v_tz)::date)::timestamp AT TIME ZONE v_tz;
  v_today_end := v_today_start + interval '1 day';

  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons
  WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN;
  END IF;

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
  WHERE e.person_id = ANY(v_person_ids)
    AND e.status IN ('scheduled', 'sent')
    AND (
      (e.actual_at >= p_now_timestamptz - interval '1 minute' AND e.actual_at < p_now_timestamptz + interval '1 minute')
      OR (e.actual_at < p_now_timestamptz AND e.actual_at >= v_today_start AND e.actual_at < v_today_end)
    )
  ORDER BY e.actual_at;
END;
$$;

COMMENT ON FUNCTION public.get_medication_dose_reminder_payload IS
  'Return dose events due in 1-min window or overdue for today; status scheduled or sent; includes medication_name, amount, unit, time_str for SW to build localized body.';
