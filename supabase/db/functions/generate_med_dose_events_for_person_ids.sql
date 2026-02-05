-- Function: generate_med_dose_events_for_person_ids()
-- Core generator for medication dose events

CREATE OR REPLACE FUNCTION public.generate_med_dose_events_for_person_ids(
  p_person_ids uuid[],
  p_timezone text,
  p_horizon_days int DEFAULT 7
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_today date;
  v_date date;
  v_dow int;
  v_reg record;
  v_schedule jsonb;
  v_duration jsonb;
  v_mode text;
  v_times jsonb;
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
  v_ref timestamptz;
BEGIN
  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
  v_today := (now() AT TIME ZONE v_tz)::date;

  FOR v_reg IN
    SELECT r.id, r.person_id, r.custom_name, r.schedule, r.duration, r.dose_definition
    FROM public.med_regimens r
    WHERE r.person_id = ANY(p_person_ids)
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

    IF v_mode = 'interval_hours' THEN
      v_every := (v_schedule->'interval'->>'every')::int;
      IF v_every IS NOT NULL AND v_every > 0 THEN
        v_slot_amount := (v_schedule->'amount')::text::numeric;
        IF v_slot_amount IS NULL OR v_slot_amount < 1 THEN
          v_slot_amount := (v_planned_intake->'intake'->>'amount')::numeric;
        END IF;
        IF v_slot_amount IS NULL THEN v_slot_amount := 1; END IF;
        v_slot_planned := jsonb_set(v_planned_intake, '{intake,amount}', to_jsonb(v_slot_amount));
        v_ref := (greatest(v_start_date, v_today)::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
        v_slot_ts := v_ref;
        WHILE v_slot_ts < now() LOOP
          v_slot_ts := v_slot_ts + (v_every || ' hours')::interval;
        END LOOP;
        WHILE v_slot_ts < now() + (p_horizon_days || ' days')::interval LOOP
          IF (v_slot_ts AT TIME ZONE v_tz)::date < v_start_date THEN
            NULL;
          ELSIF v_end_type = 'until_date' AND v_end_date IS NOT NULL AND (v_slot_ts AT TIME ZONE v_tz)::date > v_end_date THEN
            NULL;
          ELSIF v_end_type = 'for_days' AND v_days_count IS NOT NULL AND (v_slot_ts AT TIME ZONE v_tz)::date >= v_start_date + (v_days_count || ' days')::interval THEN
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
          v_slot_ts := v_slot_ts + (v_every || ' hours')::interval;
        END LOOP;
      END IF;
      CONTINUE;
    END IF;

    v_times := v_schedule->'times';
    IF v_mode = 'interval_days' AND (v_times IS NULL OR jsonb_typeof(v_times) != 'array' OR jsonb_array_length(v_times) = 0) THEN
      v_times := jsonb_build_array(COALESCE(v_schedule->>'time_of_day', '09:00'));
    END IF;
    IF (v_times IS NULL OR jsonb_typeof(v_times) != 'array') AND v_mode != 'interval_days' THEN
      CONTINUE;
    END IF;

    FOR v_i IN 0 .. (p_horizon_days - 1)
    LOOP
      v_date := v_today + (v_i || ' days')::interval;
      IF v_date < v_start_date THEN
        CONTINUE;
      END IF;
      v_dow := extract(isodow from v_date)::int;
      IF v_dow = 7 THEN v_dow := 0; END IF;

      IF v_mode = 'daily_times' THEN
        FOR v_slot IN SELECT t.ordinality::int AS idx, t.elem AS slot_time FROM jsonb_array_elements_text(v_times) WITH ORDINALITY AS t(elem, ordinality)
        LOOP
          v_slot_amount := (v_schedule->'amounts'->(v_slot.idx - 1))::text::numeric;
          IF v_slot_amount IS NULL OR v_slot_amount < 1 THEN
            v_slot_amount := (v_planned_intake->'intake'->>'amount')::numeric;
          END IF;
          IF v_slot_amount IS NULL THEN v_slot_amount := 1; END IF;
          v_slot_planned := jsonb_set(v_planned_intake, '{intake,amount}', to_jsonb(v_slot_amount));

          v_slot_ts := (v_date::text || ' ' || v_slot.slot_time)::timestamp AT TIME ZONE v_tz;
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
          FOR v_slot IN SELECT t.ordinality::int AS idx, t.elem AS slot_time FROM jsonb_array_elements_text(v_times) WITH ORDINALITY AS t(elem, ordinality)
          LOOP
            v_slot_amount := (v_schedule->'amounts'->(v_slot.idx - 1))::text::numeric;
            IF v_slot_amount IS NULL OR v_slot_amount < 1 THEN
              v_slot_amount := (v_planned_intake->'intake'->>'amount')::numeric;
            END IF;
            IF v_slot_amount IS NULL THEN v_slot_amount := 1; END IF;
            v_slot_planned := jsonb_set(v_planned_intake, '{intake,amount}', to_jsonb(v_slot_amount));

            v_slot_ts := (v_date::text || ' ' || v_slot.slot_time)::timestamp AT TIME ZONE v_tz;
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
        IF v_every IS NOT NULL AND v_every > 0 THEN
          IF (v_date - v_start_date) % v_every = 0 THEN
            FOR v_slot IN SELECT t.ordinality::int AS idx, t.elem AS slot_time FROM jsonb_array_elements_text(v_times) WITH ORDINALITY AS t(elem, ordinality)
            LOOP
              v_slot_amount := (v_schedule->'amounts'->(v_slot.idx - 1))::text::numeric;
              IF v_slot_amount IS NULL OR v_slot_amount < 1 THEN
                v_slot_amount := (v_planned_intake->'intake'->>'amount')::numeric;
              END IF;
              IF v_slot_amount IS NULL THEN v_slot_amount := 1; END IF;
              v_slot_planned := jsonb_set(v_planned_intake, '{intake,amount}', to_jsonb(v_slot_amount));

              v_slot_ts := (v_date::text || ' ' || v_slot.slot_time)::timestamp AT TIME ZONE v_tz;
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
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.generate_med_dose_events_for_person_ids(uuid[], text, int) IS
  'Single reusable generator: med_dose_events for given person ids over horizon. Supports one_off, interval_hours, daily_times, days_of_week, interval_days. Respects duration.start_date so intakes only start on or after start date. Used by cron and by post create/edit.';
