-- Function: clear_future_med_dose_events()
-- Delete future scheduled/sent dose events for a user

CREATE OR REPLACE FUNCTION public.clear_future_med_dose_events(
  p_auth_user_id uuid,
  p_horizon_days int DEFAULT 7
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person_ids uuid[];
  v_deleted int;
BEGIN
  -- Validate caller: authenticated users may only clear their own; cron (no session) allowed only for trusted roles
  IF auth.uid() IS NOT NULL THEN
    IF p_auth_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Not authorized to clear events for another user';
    END IF;
  ELSIF current_user IS NULL OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons
  WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH deleted AS (
    DELETE FROM public.med_dose_events e
    USING public.med_regimens r
    WHERE e.regimen_id = r.id
      AND r.person_id = ANY(v_person_ids)
      AND e.status IN ('scheduled', 'sent')
      AND e.scheduled_at >= now()
      AND e.scheduled_at < now() + (COALESCE(NULLIF(p_horizon_days, 0), 7) || ' days')::interval
    RETURNING e.id
  )
  SELECT count(*)::int INTO v_deleted FROM deleted;

  RETURN v_deleted;
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.clear_future_med_dose_events(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_future_med_dose_events(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.clear_future_med_dose_events(uuid, int) IS
  'Delete future scheduled/sent dose events for user; use before regenerating with a different timezone.';
