-- ============================================================================
-- MED REGIMENS, DOSE EVENTS, INVENTORY (single migration for DB reset)
-- Aggregates: create tables, optional data migration, RPCs, undo/edit, generator fixes, per-slot amounts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums and tables (med_regimens, med_dose_events, med_inventory_transactions)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medication_status') THEN
    CREATE TYPE public.medication_status AS ENUM ('active', 'paused', 'completed', 'archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medication_unit') THEN
    CREATE TYPE public.medication_unit AS ENUM (
      'pill', 'ml', 'drops', 'inhalation', 'patch', 'other', 'iu', 'ampoule', 'capsule',
      'application', 'gram', 'injection', 'milligram', 'spray', 'portion',
      'tablespoon', 'teaspoon', 'unit', 'suppository'
    );
  END IF;
END
$$;

CREATE TYPE public.med_dose_event_status AS ENUM (
  'scheduled',
  'sent',
  'taken',
  'skipped',
  'snoozed',
  'missed',
  'cancelled'
);

CREATE TYPE public.med_inventory_transaction_type AS ENUM (
  'decrement',
  'refill',
  'set_absolute',
  'correction'
);

CREATE TYPE public.med_intake_advice_type AS ENUM (
  'before_meal',
  'with_meal',
  'after_meal',
  'before_bed',
  'morning_fasting',
  'custom',
  'none'
);

CREATE TABLE public.med_regimens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,

  custom_name text NOT NULL,
  status public.medication_status NOT NULL DEFAULT 'active',

  intake_unit public.medication_unit NOT NULL DEFAULT 'pill',
  dose_definition jsonb,

  intake_advice_type public.med_intake_advice_type DEFAULT 'none',
  intake_advice_text text,

  schedule jsonb NOT NULL,
  duration jsonb NOT NULL,
  reminder_prefs jsonb,

  inventory jsonb,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_med_regimens_person_id ON public.med_regimens(person_id);
CREATE INDEX idx_med_regimens_status ON public.med_regimens(status);
CREATE INDEX idx_med_regimens_schedule ON public.med_regimens USING GIN (schedule jsonb_path_ops);

CREATE TRIGGER update_med_regimens_updated_at
  BEFORE UPDATE ON public.med_regimens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.med_dose_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  regimen_id uuid NOT NULL REFERENCES public.med_regimens(id) ON DELETE CASCADE,

  scheduled_at timestamptz NOT NULL,
  actual_at timestamptz NOT NULL,
  planned_intake jsonb NOT NULL,

  status public.med_dose_event_status NOT NULL DEFAULT 'scheduled',
  taken_at timestamptz,
  note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_med_dose_events_regimen_scheduled_minute
  ON public.med_dose_events (regimen_id, date_trunc('minute', scheduled_at AT TIME ZONE 'UTC'))
  WHERE status IN ('scheduled', 'sent');
CREATE INDEX idx_med_dose_events_person_id ON public.med_dose_events(person_id);
CREATE INDEX idx_med_dose_events_regimen_id ON public.med_dose_events(regimen_id);
CREATE INDEX idx_med_dose_events_actual_at ON public.med_dose_events(actual_at);
CREATE INDEX idx_med_dose_events_status ON public.med_dose_events(status);
CREATE INDEX idx_med_dose_events_person_actual ON public.med_dose_events(person_id, actual_at);

CREATE TRIGGER update_med_dose_events_updated_at
  BEFORE UPDATE ON public.med_dose_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.med_inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regimen_id uuid NOT NULL REFERENCES public.med_regimens(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.med_dose_events(id) ON DELETE SET NULL,

  type public.med_inventory_transaction_type NOT NULL,
  amount numeric NOT NULL,
  unit text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_med_inventory_transactions_regimen_id ON public.med_inventory_transactions(regimen_id);
CREATE INDEX idx_med_inventory_transactions_event_id ON public.med_inventory_transactions(event_id);
CREATE INDEX idx_med_inventory_transactions_created_at ON public.med_inventory_transactions(created_at);

ALTER TABLE public.med_regimens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.med_dose_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.med_inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allowed users can read med_regimens"
  ON public.med_regimens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can insert med_regimens"
  ON public.med_regimens FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can update med_regimens"
  ON public.med_regimens FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can delete med_regimens"
  ON public.med_regimens FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.allowed_users au
    WHERE au.auth_user_id = auth.uid() OR au.email = auth.email()
  ));

CREATE POLICY "Allowed users can read med_dose_events"
  ON public.med_dose_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.med_regimens r
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE r.id = regimen_id
  ));

CREATE POLICY "Allowed users can insert med_dose_events"
  ON public.med_dose_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.med_regimens r
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE r.id = regimen_id
  ));

CREATE POLICY "Allowed users can update med_dose_events"
  ON public.med_dose_events FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.med_regimens r
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE r.id = regimen_id
  ));

CREATE POLICY "Allowed users can delete med_dose_events"
  ON public.med_dose_events FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.med_regimens r
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE r.id = regimen_id
  ));

CREATE POLICY "Allowed users can read med_inventory_transactions"
  ON public.med_inventory_transactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.med_regimens r
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE r.id = regimen_id
  ));

CREATE POLICY "Allowed users can insert med_inventory_transactions"
  ON public.med_inventory_transactions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.med_regimens r
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE r.id = regimen_id
  ));

CREATE POLICY "Allowed users can update med_inventory_transactions"
  ON public.med_inventory_transactions FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.med_regimens r
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE r.id = regimen_id
  ));

CREATE POLICY "Allowed users can delete med_inventory_transactions"
  ON public.med_inventory_transactions FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.med_regimens r
    JOIN public.allowed_users au ON (au.auth_user_id = auth.uid() OR au.email = auth.email())
    WHERE r.id = regimen_id
  ));

-- ----------------------------------------------------------------------------
-- 2. Data migration: medications -> med_regimens (only when medications exists)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'medications') THEN
    RETURN;
  END IF;

  ALTER TABLE public.med_regimens ADD COLUMN IF NOT EXISTS legacy_medication_id uuid;

  INSERT INTO public.med_regimens (
    person_id,
    custom_name,
    status,
    intake_unit,
    dose_definition,
    intake_advice_type,
    intake_advice_text,
    schedule,
    duration,
    inventory,
    notes,
    legacy_medication_id
  )
  SELECT
    m.person_id,
    m.name,
    m.status,
    m.unit,
    jsonb_build_object(
      'intake',
      jsonb_build_object(
        'amount',
        COALESCE(
          (m.schedule->'reminder_times'->0->>'amount')::numeric,
          m.one_time_amount,
          1
        ),
        'unit',
        m.unit::text
      ),
      'active',
      CASE
        WHEN m.dose_per_unit IS NOT NULL AND m.dose_per_unit != '' THEN
          jsonb_build_array(jsonb_build_object('name', 'Active', 'amount', 0, 'unit', m.dose_per_unit))
        ELSE '[]'::jsonb
      END
    ),
    CASE
      WHEN m.intake_advice IS NULL OR m.intake_advice = '' THEN 'none'::public.med_intake_advice_type
      WHEN m.intake_advice = 'before_meal' THEN 'before_meal'::public.med_intake_advice_type
      WHEN m.intake_advice = 'with_meal' THEN 'with_meal'::public.med_intake_advice_type
      WHEN m.intake_advice = 'after_meal' THEN 'after_meal'::public.med_intake_advice_type
      WHEN m.intake_advice = 'before_bed' THEN 'before_bed'::public.med_intake_advice_type
      WHEN m.intake_advice = 'morning_fasting' THEN 'morning_fasting'::public.med_intake_advice_type
      WHEN m.intake_advice = 'custom' THEN 'custom'::public.med_intake_advice_type
      ELSE 'none'::public.med_intake_advice_type
    END,
    m.intake_advice_custom,
    CASE
      WHEN m.kind = 'one_time' THEN
        jsonb_build_object('mode', 'one_off', 'due_at', m.scheduled_at)
      ELSE
        jsonb_build_object(
          'mode',
          CASE (m.schedule->'frequency'->>'type')
            WHEN 'daily' THEN 'daily_times'
            WHEN 'interval' THEN
              CASE WHEN (m.schedule->'frequency'->>'unit') = 'hour' THEN 'interval_hours' ELSE 'interval_days' END
            WHEN 'days_of_week' THEN 'days_of_week'
            ELSE 'daily_times'
          END,
          'times',
          COALESCE(
            (SELECT jsonb_agg(elem->>'time' ORDER BY elem->>'time')
             FROM jsonb_array_elements(COALESCE(m.schedule->'reminder_times', '[]'::jsonb)) AS elem),
            '[]'::jsonb
          ),
          'interval',
          COALESCE(m.schedule->'frequency'->'interval', '{}'::jsonb),
          'days_of_week',
          COALESCE(m.schedule->'frequency'->'days', '[]'::jsonb),
          'time_of_day',
          (SELECT elem->>'time'
           FROM jsonb_array_elements(COALESCE(m.schedule->'reminder_times', '[]'::jsonb)) AS elem
           LIMIT 1)
        )
    END,
    CASE
      WHEN m.kind = 'one_time' THEN jsonb_build_object('type', 'endless')
      WHEN m.schedule->'duration' IS NULL THEN jsonb_build_object('type', 'endless')
      WHEN (m.schedule->'duration'->>'end_type') = 'endless' THEN jsonb_build_object('type', 'endless')
      WHEN (m.schedule->'duration'->>'end_type') = 'end_date' THEN
        jsonb_build_object('type', 'until_date', 'end_date', m.schedule->'duration'->>'end_date')
      WHEN (m.schedule->'duration'->>'end_type') = 'days_from_start' THEN
        jsonb_build_object(
          'type', 'for_days',
          'days', (m.schedule->'duration'->>'days_count')::int,
          'start_date', m.schedule->'duration'->>'start_date'
        )
      ELSE jsonb_build_object('type', 'endless')
    END,
    CASE
      WHEN m.inventory_enabled THEN
        jsonb_build_object(
          'enabled', true,
          'current_amount', m.inventory_current,
          'unit', m.unit::text,
          'refill_threshold_amount', m.inventory_refill_threshold,
          'auto_decrement_on_taken', true
        )
      ELSE NULL
    END,
    m.notes,
    m.id
  FROM public.medications m;

  INSERT INTO public.med_dose_events (
    person_id,
    regimen_id,
    scheduled_at,
    actual_at,
    planned_intake,
    status,
    taken_at,
    note,
    created_at,
    updated_at
  )
  SELECT
    m.person_id,
    r.id,
    i.taken_at,
    i.taken_at,
    jsonb_build_object(
      'intake',
      jsonb_build_object('amount', i.amount, 'unit', m.unit::text),
      'active',
      CASE
        WHEN m.dose_per_unit IS NOT NULL AND m.dose_per_unit != '' THEN
          jsonb_build_array(jsonb_build_object('name', 'Active', 'amount', 0, 'unit', m.dose_per_unit))
        ELSE '[]'::jsonb
      END
    ),
    'taken'::public.med_dose_event_status,
    i.taken_at,
    i.note,
    i.created_at,
    i.created_at
  FROM public.medication_intakes i
  JOIN public.medications m ON m.id = i.medication_id
  JOIN public.med_regimens r ON r.legacy_medication_id = m.id;

  ALTER TABLE public.med_regimens DROP COLUMN IF EXISTS legacy_medication_id;
END
$$;

-- ============================================================================
-- One-off dose events: create as 'taken' by default
-- ============================================================================
-- generate_med_dose_events_for_horizon: for one_off insert status 'taken' and taken_at.

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

CREATE OR REPLACE FUNCTION public.get_medication_dose_reminder_payload(
  p_auth_user_id uuid,
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
  v_person_ids uuid[];
  v_tz text;
  v_today_start timestamptz;
  v_today_end timestamptz;
BEGIN
  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
  v_today_start := ((p_now_timestamptz AT TIME ZONE v_tz)::date)::timestamp AT TIME ZONE v_tz;
  v_today_end := v_today_start + interval '1 day';

  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons
  WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN;
  END IF;

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
  WHERE e.person_id = ANY(v_person_ids)
    AND e.status = 'scheduled'
    AND (
      (e.actual_at >= p_now_timestamptz - interval '1 minute' AND e.actual_at < p_now_timestamptz + interval '1 minute')
      OR (e.actual_at < p_now_timestamptz AND e.actual_at >= v_today_start AND e.actual_at < v_today_end)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_future_med_dose_events(
  p_auth_user_id uuid,
  p_horizon_days int DEFAULT 7
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_ids uuid[];
  v_deleted int;
BEGIN
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

-- ----------------------------------------------------------------------------
-- 4. mark_dose_taken, mark_dose_skipped, snooze_dose, create_medication_refill_digests, update_regimen_inventory
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_dose_taken(
  p_dose_event_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
  v_amount numeric;
  v_unit text;
  v_inv jsonb;
BEGIN
  SELECT e.id, e.regimen_id, e.planned_intake, e.actual_at
  INTO v_event
  FROM public.med_dose_events e
  WHERE e.id = p_dose_event_id
    AND e.status IN ('scheduled', 'sent', 'snoozed', 'skipped');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_amount := (v_event.planned_intake->'intake'->>'amount')::numeric;
  v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');
  IF v_amount IS NULL THEN v_amount := 1; END IF;

  UPDATE public.med_dose_events
  SET status = 'taken', taken_at = COALESCE(now(), actual_at), note = NULLIF(trim(p_note), ''), updated_at = now()
  WHERE id = p_dose_event_id;

  INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
  VALUES (v_event.regimen_id, p_dose_event_id, 'decrement', v_amount, v_unit, NULLIF(trim(p_note), ''));

  SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = v_event.regimen_id;
  IF v_inv IS NOT NULL AND (v_inv->>'enabled')::boolean IS TRUE AND (v_inv->>'auto_decrement_on_taken')::boolean IS TRUE THEN
    v_inv := jsonb_set(v_inv, '{current_amount}', to_jsonb(GREATEST(0, COALESCE((v_inv->>'current_amount')::numeric, 0) - v_amount)), true);
    UPDATE public.med_regimens SET inventory = v_inv, updated_at = now() WHERE id = v_event.regimen_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_dose_skipped(
  p_dose_event_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
  v_amount numeric;
  v_unit text;
  v_inv jsonb;
BEGIN
  SELECT e.id, e.regimen_id, e.status, e.planned_intake, e.actual_at
  INTO v_event
  FROM public.med_dose_events e
  WHERE e.id = p_dose_event_id
    AND e.status IN ('scheduled', 'sent', 'snoozed', 'taken');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_event.status = 'taken' THEN
    v_amount := (v_event.planned_intake->'intake'->>'amount')::numeric;
    v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');
    IF v_amount IS NULL THEN v_amount := 1; END IF;

    INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
    VALUES (v_event.regimen_id, p_dose_event_id, 'correction', v_amount, v_unit, 'Change to skipped');

    SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = v_event.regimen_id;
    IF v_inv IS NOT NULL AND (v_inv->>'enabled')::boolean IS TRUE THEN
      v_inv := jsonb_set(
        v_inv,
        '{current_amount}',
        to_jsonb(GREATEST(0, COALESCE((v_inv->>'current_amount')::numeric, 0) + v_amount)),
        true
      );
      UPDATE public.med_regimens SET inventory = v_inv, updated_at = now() WHERE id = v_event.regimen_id;
    END IF;
  END IF;

  UPDATE public.med_dose_events
  SET status = 'skipped', taken_at = COALESCE(actual_at, now()), note = NULLIF(trim(p_note), ''), updated_at = now()
  WHERE id = p_dose_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.snooze_dose(
  p_dose_event_id uuid,
  p_auth_user_id uuid,
  p_minutes_from_now int DEFAULT 15
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
  v_new_actual_at timestamptz;
  v_title text;
  v_body text;
  v_url text := '/health/medications';
BEGIN
  SELECT e.id, e.regimen_id, e.actual_at, e.planned_intake, r.custom_name
  INTO v_event
  FROM public.med_dose_events e
  JOIN public.med_regimens r ON r.id = e.regimen_id
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

  INSERT INTO public.notification_digests (auth_user_id, type, scheduled_at, window_start, window_end, payload_json)
  VALUES (
    p_auth_user_id,
    'medication_snoozed',
    v_new_actual_at,
    date_trunc('minute', v_new_actual_at),
    date_trunc('minute', v_new_actual_at) + interval '1 minute',
    jsonb_build_object(
      'title', v_title,
      'body', v_body,
      'url', v_url,
      'dose_event_id', p_dose_event_id
    )
  );
END;
$$;

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
BEGIN
  SELECT array_agg(id) INTO v_person_ids
  FROM public.persons WHERE auth_user_id = p_auth_user_id;

  IF v_person_ids IS NULL OR array_length(v_person_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_today := (now() AT TIME ZONE 'UTC')::date;

  FOR v_reg IN
    SELECT r.id, r.custom_name, r.inventory
    FROM public.med_regimens r
    WHERE r.person_id = ANY(v_person_ids)
      AND r.status = 'active'
      AND r.inventory IS NOT NULL
      AND (r.inventory->>'enabled')::boolean IS TRUE
      AND (r.inventory->>'current_amount')::numeric IS NOT NULL
      AND (r.inventory->>'refill_threshold_amount')::numeric IS NOT NULL
      AND (r.inventory->>'current_amount')::numeric <= (r.inventory->>'refill_threshold_amount')::numeric
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_digests d
      WHERE d.auth_user_id = p_auth_user_id
        AND d.type = 'medication_refill'
        AND (d.payload_json->>'regimen_id') = v_reg.id::text
        AND d.scheduled_at::date = v_today
        AND d.sent_at IS NULL
    ) THEN
      INSERT INTO public.notification_digests (auth_user_id, type, scheduled_at, payload_json)
      VALUES (
        p_auth_user_id,
        'medication_refill',
        now(),
        jsonb_build_object(
          'title', 'Medications',
          'body', 'Low stock: ' || v_reg.custom_name,
          'url', '/health/medications',
          'regimen_id', v_reg.id
        )
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_regimen_inventory(
  p_regimen_id uuid,
  p_type text,
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv jsonb;
  v_current numeric;
  v_unit text;
BEGIN
  IF p_type NOT IN ('refill', 'set_absolute', 'correction') OR p_amount IS NULL THEN
    RETURN;
  END IF;

  SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = p_regimen_id;
  IF v_inv IS NULL OR (v_inv->>'enabled')::boolean IS NOT TRUE THEN
    RETURN;
  END IF;

  v_unit := COALESCE(v_inv->>'unit', 'pill');
  v_current := COALESCE((v_inv->>'current_amount')::numeric, 0);

  IF p_type = 'refill' THEN
    v_inv := jsonb_set(v_inv, '{current_amount}', to_jsonb(v_current + p_amount), true);
  ELSIF p_type = 'set_absolute' THEN
    v_inv := jsonb_set(v_inv, '{current_amount}', to_jsonb(GREATEST(0, p_amount)), true);
  ELSIF p_type = 'correction' THEN
    v_inv := jsonb_set(v_inv, '{current_amount}', to_jsonb(GREATEST(0, v_current + p_amount)), true);
  END IF;

  INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
  VALUES (p_regimen_id, NULL, p_type::public.med_inventory_transaction_type, p_amount, v_unit, NULLIF(trim(p_note), ''));

  UPDATE public.med_regimens SET inventory = v_inv, updated_at = now() WHERE id = p_regimen_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. undo_dose_intake
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_dose_intake(p_dose_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
  v_amount numeric;
  v_unit text;
  v_inv jsonb;
BEGIN
  SELECT e.id, e.regimen_id, e.status, e.planned_intake
  INTO v_event
  FROM public.med_dose_events e
  WHERE e.id = p_dose_event_id
    AND e.status IN ('taken', 'skipped', 'missed');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_event.status = 'taken' THEN
    v_amount := (v_event.planned_intake->'intake'->>'amount')::numeric;
    v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');
    IF v_amount IS NULL THEN v_amount := 1; END IF;

    INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
    VALUES (v_event.regimen_id, p_dose_event_id, 'correction', v_amount, v_unit, 'Undo intake');

    SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = v_event.regimen_id;
    IF v_inv IS NOT NULL AND (v_inv->>'enabled')::boolean IS TRUE THEN
      v_inv := jsonb_set(
        v_inv,
        '{current_amount}',
        to_jsonb(GREATEST(0, COALESCE((v_inv->>'current_amount')::numeric, 0) + v_amount)),
        true
      );
      UPDATE public.med_regimens SET inventory = v_inv, updated_at = now() WHERE id = v_event.regimen_id;
    END IF;
  END IF;

  UPDATE public.med_dose_events
  SET status = 'scheduled', taken_at = NULL, note = NULL, updated_at = now()
  WHERE id = p_dose_event_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. update_dose_event_resolution_details (edit taken_at, amount, note)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_dose_event_resolution_details(
  p_dose_event_id uuid,
  p_taken_at timestamptz DEFAULT NULL,
  p_amount_taken numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
  v_old_amount numeric;
  v_new_amount numeric;
  v_unit text;
  v_inv jsonb;
  v_planned jsonb;
BEGIN
  SELECT e.id, e.regimen_id, e.status, e.planned_intake
  INTO v_event
  FROM public.med_dose_events e
  WHERE e.id = p_dose_event_id
    AND e.status IN ('taken', 'skipped');

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_unit := COALESCE(v_event.planned_intake->'intake'->>'unit', 'pill');

  IF v_event.status = 'taken' AND p_amount_taken IS NOT NULL THEN
    v_old_amount := (v_event.planned_intake->'intake'->>'amount')::numeric;
    IF v_old_amount IS NULL THEN v_old_amount := 1; END IF;
    v_new_amount := GREATEST(0, p_amount_taken);

    IF v_new_amount <> v_old_amount THEN
      INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
      VALUES (v_event.regimen_id, p_dose_event_id, 'correction', v_old_amount, v_unit, 'Edit amount taken');

      SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = v_event.regimen_id;
      IF v_inv IS NOT NULL AND (v_inv->>'enabled')::boolean IS TRUE THEN
        v_inv := jsonb_set(
          v_inv,
          '{current_amount}',
          to_jsonb(GREATEST(0, COALESCE((v_inv->>'current_amount')::numeric, 0) + v_old_amount)),
          true
        );
        UPDATE public.med_regimens SET inventory = v_inv, updated_at = now() WHERE id = v_event.regimen_id;
      END IF;

      INSERT INTO public.med_inventory_transactions (regimen_id, event_id, type, amount, unit, note)
      VALUES (v_event.regimen_id, p_dose_event_id, 'decrement', v_new_amount, v_unit, NULLIF(trim(COALESCE(p_note, '')), ''));

      SELECT r.inventory INTO v_inv FROM public.med_regimens r WHERE r.id = v_event.regimen_id;
      IF v_inv IS NOT NULL AND (v_inv->>'enabled')::boolean IS TRUE AND (v_inv->>'auto_decrement_on_taken')::boolean IS TRUE THEN
        v_inv := jsonb_set(v_inv, '{current_amount}', to_jsonb(GREATEST(0, COALESCE((v_inv->>'current_amount')::numeric, 0) - v_new_amount)), true);
        UPDATE public.med_regimens SET inventory = v_inv, updated_at = now() WHERE id = v_event.regimen_id;
      END IF;

      v_planned := jsonb_set(
        COALESCE(v_event.planned_intake, '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb),
        '{intake}',
        COALESCE(v_event.planned_intake->'intake', '{}'::jsonb) || jsonb_build_object('amount', v_new_amount, 'unit', v_unit)
      );
      UPDATE public.med_dose_events
      SET planned_intake = v_planned,
          taken_at = COALESCE(p_taken_at, taken_at),
          note = CASE WHEN p_note IS NOT NULL THEN NULLIF(trim(p_note), '') ELSE note END,
          updated_at = now()
      WHERE id = p_dose_event_id;
      RETURN;
    END IF;
  END IF;

  UPDATE public.med_dose_events
  SET taken_at = COALESCE(p_taken_at, taken_at),
      note = CASE WHEN p_note IS NOT NULL THEN NULLIF(trim(p_note), '') ELSE note END,
      updated_at = now()
  WHERE id = p_dose_event_id;
END;
$$;

-- Cleanup: remove duplicate scheduled/sent events where a resolved event exists for same regimen+minute
DELETE FROM public.med_dose_events e1
WHERE e1.status IN ('scheduled', 'sent')
  AND EXISTS (
    SELECT 1 FROM public.med_dose_events e2
    WHERE e2.regimen_id = e1.regimen_id
      AND date_trunc('minute', e2.scheduled_at) = date_trunc('minute', e1.scheduled_at)
      AND e2.id <> e1.id
      AND e2.status IN ('taken', 'skipped', 'missed')
  );

COMMENT ON FUNCTION public.generate_med_dose_events_for_horizon IS 'Generate med_dose_events for the next horizon days; idempotent; uses schedule.amounts per slot when present.';
COMMENT ON FUNCTION public.get_medication_dose_reminder_payload IS 'Return dose events due in 1-min window or overdue for today; includes medication_name, amount, unit, time_str for SW to build localized body.';
COMMENT ON FUNCTION public.clear_future_med_dose_events IS 'Delete future scheduled/sent dose events for user; use before regenerating with a different timezone.';
COMMENT ON FUNCTION public.mark_dose_taken IS 'Mark dose event as taken; allow from scheduled/sent/snoozed/skipped.';
COMMENT ON FUNCTION public.mark_dose_skipped IS 'Mark dose event as skipped; allow from scheduled/sent/snoozed/taken; reverse inventory if was taken.';
COMMENT ON FUNCTION public.snooze_dose IS 'Snooze dose: update actual_at and create medication_snoozed digest for push at new time.';
COMMENT ON FUNCTION public.create_medication_refill_digests IS 'Create refill notification digests for regimens with low stock (dedupe per regimen per day).';
COMMENT ON FUNCTION public.update_regimen_inventory IS 'Insert inventory transaction (refill/set_absolute/correction) and update regimen inventory current_amount.';
COMMENT ON FUNCTION public.undo_dose_intake IS 'Revert dose event from taken/skipped to scheduled; reverse inventory if was taken.';
COMMENT ON FUNCTION public.update_dose_event_resolution_details IS 'Update taken_at, note, and optionally amount taken (for taken events; adjusts inventory).';

-- ----------------------------------------------------------------------------
-- Overdue medication reminder: interval (user_preferences) and last-sent (notification_digests)
-- Notify for overdue doses every N minutes within the same day; stop when next day starts.
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS overdue_reminder_interval_minutes integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.user_preferences.overdue_reminder_interval_minutes IS 'Notify for overdue medication doses every this many minutes after overdue time, within the same day only. Default 30.';

ALTER TABLE public.notification_digests
  ADD COLUMN IF NOT EXISTS overdue_sent_at timestamptz;

COMMENT ON COLUMN public.notification_digests.overdue_sent_at IS 'Last time we sent this digest as an overdue reminder (same-day repeat). Used to enforce overdue_reminder_interval_minutes.';

-- ============================================================================
-- Soft-delete support (med_regimens, med_dose_events)
-- ============================================================================
-- When medication is "deleted", regimen and dose events are marked deleted_at;
-- when "archived", only status is set to archived and history stays visible.

ALTER TABLE public.med_regimens
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

ALTER TABLE public.med_dose_events
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_med_regimens_deleted_at
  ON public.med_regimens(person_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_med_dose_events_deleted_at
  ON public.med_dose_events(regimen_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.med_regimens.deleted_at IS 'Set when medication is deleted (soft-delete); null for active/archived.';
COMMENT ON COLUMN public.med_dose_events.deleted_at IS 'Set when regimen is deleted; keeps history hidden but recoverable.';