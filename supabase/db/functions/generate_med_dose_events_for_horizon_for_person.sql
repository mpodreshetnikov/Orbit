-- Function: generate_med_dose_events_for_horizon_for_person()
-- Generate dose events for a single person (post create/edit entry point)

CREATE OR REPLACE FUNCTION public.generate_med_dose_events_for_horizon_for_person(
  p_person_id uuid,
  p_timezone text,
  p_horizon_days int DEFAULT 7
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.generate_med_dose_events_for_person_ids(ARRAY[p_person_id], p_timezone, p_horizon_days);
END;
$$;

COMMENT ON FUNCTION public.generate_med_dose_events_for_horizon_for_person(uuid, text, int) IS
  'Generate med_dose_events for one person over the horizon. Used after create/edit regimen. Delegates to generate_med_dose_events_for_person_ids.';
