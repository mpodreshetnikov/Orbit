-- Function: clear_future_med_dose_events_for_person()
-- Delete future scheduled/sent dose events for a single person

CREATE OR REPLACE FUNCTION public.clear_future_med_dose_events_for_person(
  p_person_id uuid,
  p_horizon_days int DEFAULT 7
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted int;
BEGIN
  WITH deleted AS (
    DELETE FROM public.med_dose_events e
    USING public.med_regimens r
    WHERE e.regimen_id = r.id
      AND r.person_id = p_person_id
      AND e.status IN ('scheduled', 'sent')
      AND e.scheduled_at >= now()
      AND e.scheduled_at < now() + (COALESCE(NULLIF(p_horizon_days, 0), 7) || ' days')::interval
    RETURNING e.id
  )
  SELECT count(*)::int INTO v_deleted FROM deleted;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.clear_future_med_dose_events_for_person(uuid, int) IS
  'Delete future scheduled/sent dose events for one person. Used when regenerating events for a specific person.';
