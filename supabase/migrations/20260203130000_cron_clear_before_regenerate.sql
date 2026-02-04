-- ============================================================================
-- Cron: clear events before regenerating to fix timezone-related duplicates
-- ============================================================================
-- The cron was only using NOT EXISTS to avoid duplicates, but this doesn't
-- help when the timezone changed (events at different times aren't caught).
-- Now the cron clears future scheduled events before regenerating, ensuring
-- stale events from a different timezone get removed.
-- ============================================================================

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
  v_cleared int;
  v_horizon int;
BEGIN
  v_horizon := COALESCE(NULLIF(p_horizon_days, 0), 7);

  FOR v_rec IN
    SELECT DISTINCT p.auth_user_id
    FROM public.persons p
    JOIN public.med_regimens r ON r.person_id = p.id
      AND (r.deleted_at IS NULL)
      AND r.status = 'active'
  LOOP
    v_events := 0;
    v_refills := 0;

    SELECT COALESCE(NULLIF(TRIM(up.checkup_notification_timezone), ''), 'UTC')
    INTO v_tz
    FROM public.user_preferences up
    WHERE up.auth_user_id = v_rec.auth_user_id;

    v_tz := COALESCE(NULLIF(TRIM(v_tz), ''), 'UTC');

    -- Clear existing future scheduled events before regenerating.
    -- This ensures events created with a different timezone get removed.
    SELECT public.clear_future_med_dose_events(
      v_rec.auth_user_id,
      v_horizon
    ) INTO v_cleared;

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
END;
$$;

COMMENT ON FUNCTION public.run_med_event_generation_for_all_users IS
  'Run event generation + refill digests for every user with active regimens. Clears future events before regenerating to fix timezone issues. Used by cron; horizon_days defaults to 7.';
