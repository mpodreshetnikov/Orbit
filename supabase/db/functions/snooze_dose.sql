-- Function: snooze_dose()
-- Snooze a dose event and create notification digest

CREATE OR REPLACE FUNCTION public.snooze_dose(
  p_dose_event_id uuid,
  p_auth_user_id uuid,
  p_minutes_from_now int DEFAULT 15
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_new_actual_at timestamptz;
  v_title text;
  v_body text;
  v_url text := '/health/medications';
  v_person_name text;
  v_person_owner_user_id uuid;
  v_prefix text;
BEGIN
  -- Validate caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT e.id, e.regimen_id, e.actual_at, e.planned_intake, r.custom_name, e.person_id, p.name, p.auth_user_id
  INTO v_event
  FROM public.med_dose_events e
  JOIN public.med_regimens r ON r.id = e.regimen_id
  JOIN public.persons p ON p.id = e.person_id
  WHERE e.id = p_dose_event_id AND e.status IN ('scheduled', 'sent', 'snoozed');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_new_actual_at := now() + (p_minutes_from_now || ' minutes')::interval;

  UPDATE public.med_dose_events
  SET actual_at = v_new_actual_at, status = 'snoozed', updated_at = now()
  WHERE id = p_dose_event_id;

  v_title := 'Medications';
  v_body := v_event.custom_name || ' (' || COALESCE(v_event.planned_intake->'intake'->>'amount', '1') || ' ' || COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill') || ')';
  v_person_name := v_event.name;
  v_person_owner_user_id := v_event.auth_user_id;

  IF v_person_owner_user_id = p_auth_user_id THEN
    v_prefix := NULL;
  ELSE
    SELECT COALESCE(NULLIF(TRIM(r.custom_prefix), ''), v_person_name)
    INTO v_prefix
    FROM public.notification_routing r
    WHERE r.recipient_user_id = p_auth_user_id
      AND r.person_id = v_event.person_id;

    v_prefix := COALESCE(v_prefix, v_person_name);
  END IF;

  INSERT INTO public.notification_digests (
    auth_user_id,
    person_id,
    type,
    scheduled_at,
    window_start,
    window_end,
    payload_json
  )
  VALUES (
    p_auth_user_id,
    v_event.person_id,
    'medication_snoozed',
    v_new_actual_at,
    date_trunc('minute', v_new_actual_at),
    date_trunc('minute', v_new_actual_at) + interval '1 minute',
    jsonb_build_object(
      'title', v_title,
      'body', v_body,
      'url', v_url,
      'dose_event_id', p_dose_event_id,
      'person_id', v_event.person_id,
      'person_name', v_person_name,
      'title_prefix', v_prefix
    )
  );
END;
$$;

-- Security: restrict execution
REVOKE ALL ON FUNCTION public.snooze_dose(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snooze_dose(uuid, uuid, int) TO authenticated;

COMMENT ON FUNCTION public.snooze_dose(uuid, uuid, int) IS
  'Snooze dose: update actual_at and create medication_snoozed digest with person metadata.';
