-- Function: run_med_event_generation_for_all_users(p_horizon_days)
-- Cron function: clear future dose events, generate for horizon, then refill digests.
-- Call with run_med_event_generation_for_all_users() or run_med_event_generation_for_all_users(7).

CREATE OR REPLACE FUNCTION public.run_med_event_generation_for_all_users(
  p_horizon_days int DEFAULT 7
)
RETURNS TABLE(auth_user_id uuid, events_generated int, refill_digests_created int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_tz text;
  v_events int;
  v_refills int;
  v_horizon int;
BEGIN
  v_horizon := COALESCE(NULLIF(p_horizon_days, 0), 7);

  FOR v_rec IN
    SELECT DISTINCT p.auth_user_id
    FROM public.persons p
    JOIN public.med_regimens r ON r.person_id = p.id
      AND (r.deleted_at IS NULL)
      AND r.status = 'active'
    WHERE p.auth_user_id IS NOT NULL
  LOOP
    v_events := 0;
    v_refills := 0;

    SELECT COALESCE(NULLIF(TRIM(up.checkup_notification_timezone), ''), 'UTC')
    INTO v_tz
    FROM public.user_preferences up
    WHERE up.auth_user_id = v_rec.auth_user_id;

    v_tz := COALESCE(NULLIF(TRIM(v_tz), ''), 'UTC');

    -- Clear existing future scheduled events before regenerating.
    PERFORM public.clear_future_med_dose_events(
      v_rec.auth_user_id,
      v_horizon
    );

    SELECT public.generate_med_dose_events_for_horizon(
      v_rec.auth_user_id,
      v_tz,
      v_horizon
    ) INTO v_events;

    SELECT public.create_medication_refill_digests(v_rec.auth_user_id) INTO v_refills;

    auth_user_id := v_rec.auth_user_id;
    events_generated := v_events;
    refill_digests_created := v_refills;
    RETURN NEXT;
  END LOOP;

  FOR v_rec IN
    SELECT DISTINCT
      p.id AS person_id,
      (
        SELECT nr.recipient_user_id
        FROM public.notification_routing nr
        WHERE nr.person_id = p.id
          AND nr.enabled = true
        ORDER BY nr.created_at, nr.id
        LIMIT 1
      ) AS recipient_user_id
    FROM public.persons p
    JOIN public.med_regimens r ON r.person_id = p.id
      AND (r.deleted_at IS NULL)
      AND r.status = 'active'
    WHERE p.auth_user_id IS NULL
  LOOP
    v_events := 0;
    v_refills := 0;

    IF v_rec.recipient_user_id IS NOT NULL THEN
      SELECT COALESCE(NULLIF(TRIM(up.checkup_notification_timezone), ''), 'UTC')
      INTO v_tz
      FROM public.user_preferences up
      WHERE up.auth_user_id = v_rec.recipient_user_id;
    ELSE
      v_tz := 'UTC';
    END IF;

    v_tz := COALESCE(NULLIF(TRIM(v_tz), ''), 'UTC');

    PERFORM public.clear_future_med_dose_events_for_person(
      v_rec.person_id,
      v_horizon
    );

    SELECT public.generate_med_dose_events_for_horizon_for_person(
      v_rec.person_id,
      v_tz,
      v_horizon
    ) INTO v_events;

    IF v_rec.recipient_user_id IS NOT NULL THEN
      SELECT public.create_medication_refill_digests(v_rec.recipient_user_id) INTO v_refills;
    END IF;

    auth_user_id := v_rec.recipient_user_id;
    events_generated := v_events;
    refill_digests_created := v_refills;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.run_med_event_generation_for_all_users(int) IS
  'Cron function: generate dose events for all users with persons, using their timezone preferences.';
