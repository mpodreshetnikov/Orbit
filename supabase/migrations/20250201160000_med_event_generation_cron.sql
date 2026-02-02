-- ============================================================================
-- Medical event generation cron: run for all users (used by pg_cron)
-- ============================================================================
-- Call generate_med_dose_events_for_horizon and create_medication_refill_digests
-- for every user who has at least one active regimen. Run this on a schedule
-- (e.g. hourly) so dose events and refill digests stay materialized before
-- notifications-cron sends pushes.
--
-- Prerequisite: Enable "Cron" in Supabase Dashboard → Project Settings →
-- Integrations → Cron (pg_cron). Then apply this migration.
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
BEGIN
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

    SELECT public.generate_med_dose_events_for_horizon(
      v_rec.auth_user_id,
      v_tz,
      COALESCE(NULLIF(p_horizon_days, 0), 7)
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
  'Run event generation + refill digests for every user with active regimens. Used by cron; horizon_days defaults to 7.';

-- ----------------------------------------------------------------------------
-- pg_cron: schedule medical event generation every hour at :00
-- ----------------------------------------------------------------------------
-- Prerequisite: Enable "Cron" (pg_cron) in Supabase Dashboard →
-- Project Settings → Integrations → Cron. Then run this migration.
-- On local: CREATE EXTENSION IF NOT EXISTS pg_cron; in SQL if needed.
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Idempotent: remove existing job then schedule (avoids duplicate on re-run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'med-event-generation-hourly') THEN
    PERFORM cron.unschedule('med-event-generation-hourly');
  END IF;
END
$$;
-- Schedule job: every hour at minute 0 (0 * * * *).
-- Run before notifications-cron so dose events exist when pushes are sent.
SELECT cron.schedule(
  'med-event-generation-hourly',  -- job name
  '0 * * * *',                    -- every hour at :00
  $$SELECT * FROM public.run_med_event_generation_for_all_users(7)$$
);