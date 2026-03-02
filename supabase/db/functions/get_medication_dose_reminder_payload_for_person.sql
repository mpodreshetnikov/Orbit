-- Function: get_medication_dose_reminder_payload_for_person()
-- Get medication dose reminder payload for a single person

CREATE OR REPLACE FUNCTION public.get_medication_dose_reminder_payload_for_person(
  p_person_id uuid,
  p_now_timestamptz timestamptz,
  p_timezone text DEFAULT NULL
)
RETURNS TABLE (
  scheduled_at timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  title text,
  body text,
  url text,
  dose_event_id uuid,
  medication_name text,
  amount text,
  unit text,
  time_str text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text;
  v_today_start timestamptz;
  v_today_end timestamptz;
BEGIN
  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
  v_today_start := ((p_now_timestamptz AT TIME ZONE v_tz)::date)::timestamp AT TIME ZONE v_tz;
  v_today_end := v_today_start + interval '1 day';

  RETURN QUERY
  SELECT
    e.actual_at,
    date_trunc('minute', e.actual_at),
    date_trunc('minute', e.actual_at) + interval '1 minute',
    'Medications'::text,
    (
      '• ' || r.custom_name
      || E'\n  '
      || COALESCE(e.planned_intake->'intake'->>'amount', '1')
      || ' '
      || COALESCE(NULLIF(trim(COALESCE(e.planned_intake->'intake'->>'unit', '')), ''), 'pill')
      || ' · '
      || to_char(e.actual_at AT TIME ZONE v_tz, 'HH24:MI')
    )::text,
    '/health/medications'::text,
    e.id,
    r.custom_name::text,
    COALESCE(e.planned_intake->'intake'->>'amount', '1')::text,
    COALESCE(NULLIF(trim(COALESCE(e.planned_intake->'intake'->>'unit', '')), ''), 'pill')::text,
    to_char(e.actual_at AT TIME ZONE v_tz, 'HH24:MI')::text
  FROM public.med_dose_events e
  JOIN public.med_regimens r ON r.id = e.regimen_id
    AND r.deleted_at IS NULL
    AND r.status = 'active'
  WHERE e.person_id = p_person_id
    AND e.status IN ('scheduled', 'sent')
    AND (
      (
        p_now_timestamptz >= date_trunc('minute', e.actual_at)
        AND p_now_timestamptz < date_trunc('minute', e.actual_at) + interval '1 minute'
      )
      OR (e.actual_at < p_now_timestamptz AND e.actual_at >= v_today_start AND e.actual_at < v_today_end)
    )
  ORDER BY e.actual_at;
END;
$$;

COMMENT ON FUNCTION public.get_medication_dose_reminder_payload_for_person(uuid, timestamptz, text) IS
  'Return dose events for one person due in the current dose minute or overdue for today. Only active, non-deleted regimens.';
