-- Function: run_med_event_generation_for_all_users()
-- Cron function to generate dose events for all users

CREATE OR REPLACE FUNCTION public.run_med_event_generation_for_all_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user record;
  v_tz text;
BEGIN
  FOR v_user IN
    SELECT DISTINCT p.auth_user_id
    FROM public.persons p
    WHERE p.auth_user_id IS NOT NULL
  LOOP
    SELECT COALESCE(NULLIF(TRIM(up.checkup_notification_timezone), ''), 'UTC')
    INTO v_tz
    FROM public.user_preferences up
    WHERE up.auth_user_id = v_user.auth_user_id;

    v_tz := COALESCE(NULLIF(TRIM(v_tz), ''), 'UTC');

    PERFORM public.generate_med_dose_events_for_horizon(v_user.auth_user_id, v_tz, 7);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.run_med_event_generation_for_all_users() IS
  'Cron function: generate dose events for all users with persons, using their timezone preferences.';
