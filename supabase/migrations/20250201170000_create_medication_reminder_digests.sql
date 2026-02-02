-- ============================================================================
-- Medication reminder digests: producer function + schema cleanup
-- ============================================================================
-- create_medication_reminder_digests(p_now_timestamptz): for each user with
-- active regimens, call get_medication_dose_reminder_payload and insert
-- notification_digests for (1) due doses in 1-min window if no unsent digest
-- exists, (2) overdue doses when interval has elapsed (one new row per send).
-- Notifications-cron calls this at start of each run, then sends all unsent.
-- Drop notification_digests.overdue_sent_at (no longer used).
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
  v_payload jsonb;
  v_exists boolean;
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
            AND (d.payload_json->>'dose_event_id') = v_row.dose_event_id::text
        ) INTO v_exists;
        IF NOT v_exists THEN
          v_payload := jsonb_build_object(
            'title', v_row.title,
            'body', v_row.body,
            'url', v_row.url,
            'dose_event_id', v_row.dose_event_id::text,
            'medication_name', v_row.medication_name,
            'amount', v_row.amount,
            'unit', v_row.unit,
            'time_str', v_row.time_str
          );
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
            v_row.scheduled_at,
            v_row.window_start,
            v_row.window_end,
            v_payload
          );
        END IF;
        CONTINUE;
      END IF;

      IF v_overdue_today THEN
        SELECT max(d.sent_at) INTO v_last_sent
        FROM public.notification_digests d
        WHERE d.auth_user_id = v_rec.auth_user_id
          AND d.type = 'medication'
          AND (d.payload_json->>'dose_event_id') = v_row.dose_event_id::text;
        v_ref := COALESCE(v_last_sent, v_row.scheduled_at);
        IF p_now_timestamptz >= v_ref + (v_interval_min || ' minutes')::interval THEN
          v_payload := jsonb_build_object(
            'title', v_row.title,
            'body', v_row.body,
            'url', v_row.url,
            'dose_event_id', v_row.dose_event_id::text,
            'medication_name', v_row.medication_name,
            'amount', v_row.amount,
            'unit', v_row.unit,
            'time_str', v_row.time_str,
            'is_overdue_reminder', true
          );
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
            v_row.scheduled_at,
            v_row.window_start,
            v_row.window_end,
            v_payload
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.create_medication_reminder_digests IS
  'Create notification_digests for due (1-min window) and overdue (interval elapsed) medication doses. Call from notifications-cron at start of each run. Uses get_medication_dose_reminder_payload for payload.';

-- Schema cleanup: drop overdue_sent_at (new flow uses sent_at and one row per send).
ALTER TABLE public.notification_digests
  DROP COLUMN IF EXISTS overdue_sent_at;
