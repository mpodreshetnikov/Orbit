-- Function: create_medication_reminder_digests()
-- Create one notification_digest per recipient+person with payload.doses

CREATE OR REPLACE FUNCTION public.create_medication_reminder_digests(
  p_now_timestamptz timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION public.create_medication_reminder_digests(timestamptz) IS
  'Create one notification_digest per recipient+person with payload.doses = [ all due/overdue doses ]. Uses routing + implicit own person.';
