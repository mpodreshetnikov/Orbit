-- ============================================================================
-- Medication cron: exclude archived and deleted regimens
-- ============================================================================
-- Bug: cron was creating reminder/refill digests and dose events for
-- archived/deleted medications. Fix: filter by (r.deleted_at IS NULL) and
-- r.status = 'active' everywhere.
-- ============================================================================

-- 1) get_medication_dose_reminder_payload_for_person: only return dose events
--    for active, non-deleted regimens (so reminders are not sent for archived meds).
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
SET search_path = public
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
    AND (r.deleted_at IS NULL)
    AND r.status = 'active'
  WHERE e.person_id = p_person_id
    AND e.status IN ('scheduled', 'sent')
    AND (
      (e.actual_at >= p_now_timestamptz - interval '1 minute' AND e.actual_at < p_now_timestamptz + interval '1 minute')
      OR (e.actual_at < p_now_timestamptz AND e.actual_at >= v_today_start AND e.actual_at < v_today_end)
    )
  ORDER BY e.actual_at;
END;
$$;

COMMENT ON FUNCTION public.get_medication_dose_reminder_payload_for_person(uuid, timestamptz, text) IS
  'Return dose events for one person due in 1-min window or overdue for today. Only active, non-deleted regimens.';

-- 2) generate_med_dose_events_for_horizon: only generate events for active,
--    non-deleted regimens (cron must not create events for archived/deleted).
CREATE OR REPLACE FUNCTION public.generate_med_dose_events_for_horizon(
  p_auth_user_id uuid,
  p_timezone text,
  p_horizon_days int DEFAULT 7
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_ids uuid[];
  v_tz text;
  v_today date;
  v_date date;
  v_dow int;
  v_reg record;
  v_schedule jsonb;
  v_duration jsonb;
  v_mode text;
  v_times jsonb;
  v_time text;
  v_slot_ts timestamptz;
  v_start_date date;
  v_end_date date;
  v_days_count int;
  v_every int;
  v_time_of_day text;
  v_days_of_week jsonb;
  v_due_at timestamptz;
  v_planned_intake jsonb;
  v_slot_planned jsonb;
  v_slot_amount numeric;
  v_slot record;
  v_inserted int := 0;
  v_in_range boolean;
  v_end_type text;
  v_i int;
BEGIN
  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons
  WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_reg IN
    SELECT r.id, r.person_id, r.custom_name, r.schedule, r.duration, r.dose_definition
    FROM public.med_regimens r
    WHERE r.person_id = ANY(v_person_ids)
      AND (r.deleted_at IS NULL)
      AND r.status = 'active'
  LOOP
    v_schedule := v_reg.schedule;
    v_duration := v_reg.duration;
    v_mode := v_schedule->>'mode';
    v_planned_intake := COALESCE(v_reg.dose_definition, jsonb_build_object('intake', jsonb_build_object('amount', 1, 'unit', 'pill'), 'active', '[]'::jsonb));

    v_end_type := v_duration->>'type';
    v_start_date := (v_duration->>'start_date')::date;
    IF v_start_date IS NULL THEN
      v_start_date := v_today;
    END IF;
    v_in_range := true;
    IF v_end_type = 'until_date' THEN
      v_end_date := (v_duration->>'end_date')::date;
      v_in_range := v_end_date IS NULL OR v_today <= v_end_date;
    ELSIF v_end_type = 'for_days' THEN
      v_days_count := (v_duration->>'days')::int;
      v_in_range := v_days_count IS NULL OR v_today < v_start_date + (v_days_count || ' days')::interval;
    END IF;
    IF NOT v_in_range THEN
      CONTINUE;
    END IF;

    IF v_mode = 'one_off' THEN
      v_due_at := (v_schedule->>'due_at')::timestamptz;
      IF v_due_at IS NOT NULL AND v_due_at >= (v_today::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz
         AND v_due_at < (v_today::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz + (p_horizon_days || ' days')::interval THEN
        INSERT INTO public.med_dose_events (person_id, regimen_id, scheduled_at, actual_at, planned_intake, status, taken_at)
        SELECT v_reg.person_id, v_reg.id, v_due_at, v_due_at, v_planned_intake, 'taken', v_due_at
        WHERE NOT EXISTS (
          SELECT 1 FROM public.med_dose_events
          WHERE regimen_id = v_reg.id AND date_trunc('minute', scheduled_at) = date_trunc('minute', v_due_at)
        );
        IF FOUND THEN v_inserted := v_inserted + 1; END IF;
      END IF;
      CONTINUE;
    END IF;

    v_times := v_schedule->'times';
    IF v_times IS NULL OR jsonb_typeof(v_times) != 'array' THEN
      CONTINUE;
    END IF;

    FOR v_i IN 0 .. (p_horizon_days - 1)
    LOOP
      v_date := v_today + (v_i || ' days')::interval;
      v_dow := extract(isodow from v_date)::int;
      IF v_dow = 7 THEN v_dow := 0; END IF;

      IF v_mode = 'daily_times' THEN
        FOR v_slot IN SELECT t.ordinality::int AS idx, t.elem AS time FROM jsonb_array_elements_text(v_times) WITH ORDINALITY AS t(elem, ordinality)
        LOOP
          v_slot_amount := (v_schedule->'amounts'->(v_slot.idx - 1))::text::numeric;
          IF v_slot_amount IS NULL OR v_slot_amount < 1 THEN
            v_slot_amount := (v_planned_intake->'intake'->>'amount')::numeric;
          END IF;
          IF v_slot_amount IS NULL THEN v_slot_amount := 1; END IF;
          v_slot_planned := jsonb_set(v_planned_intake, '{intake,amount}', to_jsonb(v_slot_amount));

          v_slot_ts := (v_date::text || ' ' || v_slot.time)::timestamp AT TIME ZONE v_tz;
          IF v_slot_ts >= now() AND v_slot_ts < now() + (p_horizon_days || ' days')::interval THEN
            IF v_end_type = 'until_date' AND v_end_date IS NOT NULL AND v_date > v_end_date THEN
              NULL;
            ELSIF v_end_type = 'for_days' AND v_days_count IS NOT NULL AND v_date >= v_start_date + (v_days_count || ' days')::interval THEN
              NULL;
            ELSE
              INSERT INTO public.med_dose_events (person_id, regimen_id, scheduled_at, actual_at, planned_intake, status)
              SELECT v_reg.person_id, v_reg.id, v_slot_ts, v_slot_ts, v_slot_planned, 'scheduled'
              WHERE NOT EXISTS (
                SELECT 1 FROM public.med_dose_events
                WHERE regimen_id = v_reg.id AND date_trunc('minute', scheduled_at) = date_trunc('minute', v_slot_ts)
              );
              IF FOUND THEN v_inserted := v_inserted + 1; END IF;
            END IF;
          END IF;
        END LOOP;
      ELSIF v_mode = 'days_of_week' THEN
        v_days_of_week := v_schedule->'days_of_week';
        IF v_days_of_week IS NOT NULL AND (v_days_of_week @> to_jsonb(v_dow)::jsonb) THEN
          FOR v_slot IN SELECT t.ordinality::int AS idx, t.elem AS time FROM jsonb_array_elements_text(v_times) WITH ORDINALITY AS t(elem, ordinality)
          LOOP
            v_slot_amount := (v_schedule->'amounts'->(v_slot.idx - 1))::text::numeric;
            IF v_slot_amount IS NULL OR v_slot_amount < 1 THEN
              v_slot_amount := (v_planned_intake->'intake'->>'amount')::numeric;
            END IF;
            IF v_slot_amount IS NULL THEN v_slot_amount := 1; END IF;
            v_slot_planned := jsonb_set(v_planned_intake, '{intake,amount}', to_jsonb(v_slot_amount));

            v_slot_ts := (v_date::text || ' ' || v_slot.time)::timestamp AT TIME ZONE v_tz;
            IF v_slot_ts >= now() THEN
              INSERT INTO public.med_dose_events (person_id, regimen_id, scheduled_at, actual_at, planned_intake, status)
              SELECT v_reg.person_id, v_reg.id, v_slot_ts, v_slot_ts, v_slot_planned, 'scheduled'
              WHERE NOT EXISTS (
                SELECT 1 FROM public.med_dose_events
                WHERE regimen_id = v_reg.id AND date_trunc('minute', scheduled_at) = date_trunc('minute', v_slot_ts)
              );
              IF FOUND THEN v_inserted := v_inserted + 1; END IF;
            END IF;
          END LOOP;
        END IF;
      ELSIF v_mode = 'interval_days' THEN
        v_every := (v_schedule->'interval'->>'every')::int;
        v_time_of_day := COALESCE(v_schedule->>'time_of_day', '09:00');
        IF v_every IS NOT NULL AND v_every > 0 THEN
          IF (v_date - v_start_date) % v_every = 0 THEN
            v_slot_ts := (v_date::text || ' ' || v_time_of_day)::timestamp AT TIME ZONE v_tz;
            IF v_slot_ts >= now() THEN
              INSERT INTO public.med_dose_events (person_id, regimen_id, scheduled_at, actual_at, planned_intake, status)
              SELECT v_reg.person_id, v_reg.id, v_slot_ts, v_slot_ts, v_planned_intake, 'scheduled'
              WHERE NOT EXISTS (
                SELECT 1 FROM public.med_dose_events
                WHERE regimen_id = v_reg.id AND date_trunc('minute', scheduled_at) = date_trunc('minute', v_slot_ts)
              );
              IF FOUND THEN v_inserted := v_inserted + 1; END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.generate_med_dose_events_for_horizon IS
  'Generate med_dose_events for the next horizon days; idempotent; only active, non-deleted regimens.';

-- 3) create_medication_refill_digests: only consider active, non-deleted regimens.
CREATE OR REPLACE FUNCTION public.create_medication_refill_digests(p_auth_user_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_ids uuid[];
  v_today date;
  v_inserted int := 0;
  v_reg record;
  v_rec record;
  v_prefix text;
BEGIN
  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_today := (now() AT TIME ZONE 'UTC')::date;

  FOR v_reg IN
    SELECT r.id, r.custom_name, r.inventory, r.person_id, p.name AS person_name, p.auth_user_id AS person_owner_user_id
    FROM public.med_regimens r
    JOIN public.persons p ON p.id = r.person_id
    WHERE r.person_id = ANY(v_person_ids)
      AND (r.deleted_at IS NULL)
      AND r.status = 'active'
      AND r.inventory IS NOT NULL
      AND (r.inventory->>'enabled')::boolean IS TRUE
      AND (r.inventory->>'current_amount')::numeric IS NOT NULL
      AND (r.inventory->>'refill_threshold_amount')::numeric IS NOT NULL
      AND (r.inventory->>'current_amount')::numeric <= (r.inventory->>'refill_threshold_amount')::numeric
  LOOP
    FOR v_rec IN
      SELECT r.recipient_user_id, r.custom_prefix, v_reg.person_name AS person_name, v_reg.person_owner_user_id AS person_owner_user_id
      FROM public.notification_routing r
      WHERE r.person_id = v_reg.person_id
        AND r.enabled = true
      UNION ALL
      SELECT p.auth_user_id AS recipient_user_id, NULL::text AS custom_prefix, v_reg.person_name AS person_name, v_reg.person_owner_user_id AS person_owner_user_id
      FROM public.persons p
      WHERE p.id = v_reg.person_id
        AND p.auth_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.notification_routing r2
          WHERE r2.recipient_user_id = p.auth_user_id
            AND r2.person_id = p.id
        )
    LOOP
      IF v_rec.person_owner_user_id = v_rec.recipient_user_id THEN
        v_prefix := NULL;
      ELSE
        v_prefix := COALESCE(NULLIF(TRIM(v_rec.custom_prefix), ''), v_rec.person_name);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.notification_digests d
        WHERE d.auth_user_id = v_rec.recipient_user_id
          AND d.person_id = v_reg.person_id
          AND d.type = 'medication_refill'
          AND (d.payload_json->>'regimen_id') = v_reg.id::text
          AND d.scheduled_at::date = v_today
          AND d.sent_at IS NULL
      ) THEN
        INSERT INTO public.notification_digests (
          auth_user_id,
          person_id,
          type,
          scheduled_at,
          payload_json
        ) VALUES (
          v_rec.recipient_user_id,
          v_reg.person_id,
          'medication_refill',
          now(),
          jsonb_build_object(
            'title', 'Medications',
            'body', 'Low stock: ' || v_reg.custom_name,
            'url', '/health/medications',
            'regimen_id', v_reg.id,
            'person_id', v_reg.person_id,
            'person_name', v_reg.person_name,
            'title_prefix', v_prefix
          )
        );
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.create_medication_refill_digests IS
  'Create refill notification_digests for low-stock regimens for all routed recipients (including implicit own person). Only active, non-deleted regimens.';
