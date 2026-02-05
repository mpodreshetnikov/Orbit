-- Function: generate_med_dose_events_for_horizon()
-- Generate dose events for a user's persons (cron entry point)

CREATE OR REPLACE FUNCTION public.generate_med_dose_events_for_horizon(
  p_auth_user_id uuid,
  p_timezone text,
  p_horizon_days int DEFAULT 7
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons
  WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  RETURN public.generate_med_dose_events_for_person_ids(v_person_ids, p_timezone, p_horizon_days);
END;
$$;

COMMENT ON FUNCTION public.generate_med_dose_events_for_horizon(uuid, text, int) IS
  'Generate med_dose_events for the next horizon days for current user''s persons. Delegates to generate_med_dose_events_for_person_ids.';
