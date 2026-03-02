-- One-off production repair: Demi medication historical backfill
-- Scope:
--   - Person: Demi (kind='pet')
--   - Window: 2026-02-18 00:00:00 Asia/Krasnoyarsk -> script start timestamp
--   - Insert missing events as taken
--   - Insert matching inventory decrement transactions when auto-decrement is enabled
--   - Apply inventory current_amount decrement (floored at zero)
--
-- Safety:
--   - Hard-fails if Demi resolution is ambiguous or missing
--   - Hard-fails if any active Demi regimen mode is outside daily_times / interval_days
--   - Idempotent by regimen + scheduled minute (existing-event check)

CREATE TEMP TABLE IF NOT EXISTS pg_temp._demi_backfill_params AS
SELECT
  'Demi'::text AS person_name,
  'pet'::text AS person_kind,
  'Asia/Krasnoyarsk'::text AS timezone_name,
  '2026-02-18 00:00:00 Asia/Krasnoyarsk'::timestamptz AS start_at,
  now() AS end_at,
  'historical backfill after ownerless-person cron gap'::text AS backfill_note;

TRUNCATE pg_temp._demi_backfill_params;
INSERT INTO pg_temp._demi_backfill_params
SELECT
  'Demi'::text,
  'pet'::text,
  'Asia/Krasnoyarsk'::text,
  '2026-02-18 00:00:00 Asia/Krasnoyarsk'::timestamptz,
  now(),
  'historical backfill after ownerless-person cron gap'::text;

CREATE OR REPLACE FUNCTION pg_temp._demi_backfill_candidates(
  p_person_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_timezone text
)
RETURNS TABLE (
  person_id uuid,
  regimen_id uuid,
  scheduled_at timestamptz,
  planned_intake jsonb
)
LANGUAGE sql
AS $$
WITH regimens AS (
  SELECT
    r.id AS regimen_id,
    r.person_id,
    r.custom_name,
    r.schedule,
    r.duration,
    r.dose_definition,
    r.intake_unit,
    r.inventory,
    r.schedule->>'mode' AS mode,
    COALESCE((r.duration->>'start_date')::date, (p_start_at AT TIME ZONE p_timezone)::date) AS start_date,
    (r.duration->>'type') AS end_type,
    (r.duration->>'end_date')::date AS end_date,
    (r.duration->>'days')::int AS days_count,
    (r.schedule->'interval'->>'every')::int AS every_days,
    COALESCE(
      r.dose_definition,
      jsonb_build_object(
        'intake',
        jsonb_build_object('amount', 1, 'unit', COALESCE(r.intake_unit::text, 'pill')),
        'active', '[]'::jsonb
      )
    ) AS base_planned_intake,
    COALESCE(NULLIF(r.dose_definition->'intake'->>'amount', '')::numeric, 1) AS base_amount
  FROM public.med_regimens r
  WHERE r.person_id = p_person_id
    AND r.status = 'active'
    AND r.deleted_at IS NULL
),
daily_candidates AS (
  SELECT
    r.person_id,
    r.regimen_id,
    ((day_parts.day_date::text || ' ' || slot.slot_time)::timestamp AT TIME ZONE p_timezone) AS scheduled_at,
    jsonb_set(
      r.base_planned_intake,
      '{intake,amount}',
      to_jsonb(
        COALESCE(
          NULLIF(r.schedule->'amounts'->>((slot.idx - 1)::int), '')::numeric,
          r.base_amount,
          1
        )
      ),
      true
    ) AS planned_intake
  FROM regimens r
  JOIN LATERAL generate_series(
    GREATEST(r.start_date, (p_start_at AT TIME ZONE p_timezone)::date)::timestamp,
    (p_end_at AT TIME ZONE p_timezone)::date::timestamp,
    interval '1 day'
  ) AS day_series(day_ts) ON TRUE
  JOIN LATERAL (
    SELECT day_series.day_ts::date AS day_date
  ) AS day_parts ON TRUE
  JOIN LATERAL jsonb_array_elements_text(COALESCE(r.schedule->'times', '[]'::jsonb))
    WITH ORDINALITY AS slot(slot_time, idx) ON TRUE
  WHERE r.mode = 'daily_times'
    AND (r.end_type IS DISTINCT FROM 'until_date' OR r.end_date IS NULL OR day_parts.day_date <= r.end_date)
    AND (
      r.end_type IS DISTINCT FROM 'for_days'
      OR r.days_count IS NULL
      OR day_parts.day_date < (r.start_date + make_interval(days => r.days_count))::date
    )
),
interval_candidates AS (
  SELECT
    r.person_id,
    r.regimen_id,
    ((day_parts.day_date::text || ' ' || slot.slot_time)::timestamp AT TIME ZONE p_timezone) AS scheduled_at,
    jsonb_set(
      r.base_planned_intake,
      '{intake,amount}',
      to_jsonb(
        COALESCE(
          NULLIF(r.schedule->'amounts'->>((slot.idx - 1)::int), '')::numeric,
          r.base_amount,
          1
        )
      ),
      true
    ) AS planned_intake
  FROM regimens r
  JOIN LATERAL generate_series(
    GREATEST(r.start_date, (p_start_at AT TIME ZONE p_timezone)::date)::timestamp,
    (p_end_at AT TIME ZONE p_timezone)::date::timestamp,
    interval '1 day'
  ) AS day_series(day_ts) ON TRUE
  JOIN LATERAL (
    SELECT day_series.day_ts::date AS day_date
  ) AS day_parts ON TRUE
  JOIN LATERAL (
    SELECT
      CASE
        WHEN jsonb_typeof(r.schedule->'times') = 'array' AND jsonb_array_length(r.schedule->'times') > 0
          THEN r.schedule->'times'
        ELSE jsonb_build_array(COALESCE(r.schedule->>'time_of_day', '09:00'))
      END AS times_json
  ) AS times_src ON TRUE
  JOIN LATERAL jsonb_array_elements_text(times_src.times_json)
    WITH ORDINALITY AS slot(slot_time, idx) ON TRUE
  WHERE r.mode = 'interval_days'
    AND r.every_days IS NOT NULL
    AND r.every_days > 0
    AND mod((day_parts.day_date - r.start_date), r.every_days) = 0
    AND (r.end_type IS DISTINCT FROM 'until_date' OR r.end_date IS NULL OR day_parts.day_date <= r.end_date)
    AND (
      r.end_type IS DISTINCT FROM 'for_days'
      OR r.days_count IS NULL
      OR day_parts.day_date < (r.start_date + make_interval(days => r.days_count))::date
    )
),
all_candidates AS (
  SELECT * FROM daily_candidates
  UNION ALL
  SELECT * FROM interval_candidates
),
deduped AS (
  SELECT DISTINCT ON (c.regimen_id, date_trunc('minute', c.scheduled_at))
    c.person_id,
    c.regimen_id,
    c.scheduled_at,
    c.planned_intake
  FROM all_candidates c
  WHERE c.scheduled_at >= p_start_at
    AND c.scheduled_at <= p_end_at
  ORDER BY c.regimen_id, date_trunc('minute', c.scheduled_at), c.scheduled_at
)
SELECT
  d.person_id,
  d.regimen_id,
  d.scheduled_at,
  d.planned_intake
FROM deduped d;
$$;

-- ---------------------------------------------------------------------------
-- Precheck
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person_count int;
  v_person_id uuid;
  v_bad_modes text[];
BEGIN
  SELECT count(*)
  INTO v_person_count
  FROM public.persons p
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE lower(trim(p.name)) = lower(trim(prm.person_name))
    AND p.kind::text = prm.person_kind;

  IF v_person_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 Demi person (kind=%), found %',
      (SELECT person_kind FROM pg_temp._demi_backfill_params),
      v_person_count;
  END IF;

  SELECT p.id
  INTO v_person_id
  FROM public.persons p
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE lower(trim(p.name)) = lower(trim(prm.person_name))
    AND p.kind::text = prm.person_kind
  ORDER BY p.id
  LIMIT 1;

  SELECT array_agg(DISTINCT COALESCE(r.schedule->>'mode', '<null>'))
  INTO v_bad_modes
  FROM public.med_regimens r
  WHERE r.person_id = v_person_id
    AND r.status = 'active'
    AND r.deleted_at IS NULL
    AND COALESCE(r.schedule->>'mode', '') NOT IN ('daily_times', 'interval_days');

  IF v_bad_modes IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported active regimen modes for Demi: %', v_bad_modes;
  END IF;
END;
$$;

WITH ctx AS (
  SELECT p.id AS person_id, p.name, p.kind
  FROM public.persons p
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE lower(trim(p.name)) = lower(trim(prm.person_name))
    AND p.kind::text = prm.person_kind
)
SELECT
  c.person_id,
  c.name,
  c.kind,
  prm.start_at,
  prm.end_at,
  prm.timezone_name
FROM ctx c
CROSS JOIN pg_temp._demi_backfill_params prm;

WITH ctx AS (
  SELECT p.id AS person_id
  FROM public.persons p
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE lower(trim(p.name)) = lower(trim(prm.person_name))
    AND p.kind::text = prm.person_kind
)
SELECT
  r.id AS regimen_id,
  r.custom_name,
  r.schedule->>'mode' AS mode,
  r.status,
  r.deleted_at
FROM public.med_regimens r
JOIN ctx ON ctx.person_id = r.person_id
WHERE r.status = 'active'
  AND r.deleted_at IS NULL
ORDER BY r.id;

WITH ctx AS (
  SELECT p.id AS person_id
  FROM public.persons p
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE lower(trim(p.name)) = lower(trim(prm.person_name))
    AND p.kind::text = prm.person_kind
),
candidates AS (
  SELECT c.*
  FROM ctx
  CROSS JOIN pg_temp._demi_backfill_params prm
  CROSS JOIN LATERAL pg_temp._demi_backfill_candidates(
    ctx.person_id,
    prm.start_at,
    prm.end_at,
    prm.timezone_name
  ) AS c
),
missing AS (
  SELECT c.*
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.med_dose_events e
    WHERE e.regimen_id = c.regimen_id
      AND date_trunc('minute', e.scheduled_at) = date_trunc('minute', c.scheduled_at)
  )
)
SELECT
  r.id AS regimen_id,
  r.custom_name,
  r.schedule->>'mode' AS mode,
  count(*)::bigint AS missing_event_count,
  COALESCE(
    sum(
      CASE
        WHEN COALESCE((r.inventory->>'enabled')::boolean, false)
         AND COALESCE((r.inventory->>'auto_decrement_on_taken')::boolean, false)
          THEN COALESCE(NULLIF(m.planned_intake->'intake'->>'amount', '')::numeric, 1)
        ELSE 0::numeric
      END
    ),
    0::numeric
  ) AS projected_inventory_decrement
FROM missing m
JOIN public.med_regimens r ON r.id = m.regimen_id
GROUP BY r.id, r.custom_name, r.schedule->>'mode'
ORDER BY r.id;

-- ---------------------------------------------------------------------------
-- Apply (single transaction)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS pg_temp._demi_backfill_inserted_events (
  event_id uuid PRIMARY KEY,
  regimen_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  planned_intake jsonb NOT NULL
);

CREATE TEMP TABLE IF NOT EXISTS pg_temp._demi_backfill_inventory_deltas (
  regimen_id uuid PRIMARY KEY,
  decremented_amount numeric NOT NULL
);

TRUNCATE pg_temp._demi_backfill_inserted_events;
TRUNCATE pg_temp._demi_backfill_inventory_deltas;

BEGIN;

WITH ctx AS (
  SELECT p.id AS person_id
  FROM public.persons p
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE lower(trim(p.name)) = lower(trim(prm.person_name))
    AND p.kind::text = prm.person_kind
),
candidates AS (
  SELECT c.*
  FROM ctx
  CROSS JOIN pg_temp._demi_backfill_params prm
  CROSS JOIN LATERAL pg_temp._demi_backfill_candidates(
    ctx.person_id,
    prm.start_at,
    prm.end_at,
    prm.timezone_name
  ) AS c
),
missing AS (
  SELECT c.*
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.med_dose_events e
    WHERE e.regimen_id = c.regimen_id
      AND date_trunc('minute', e.scheduled_at) = date_trunc('minute', c.scheduled_at)
  )
),
inserted AS (
  INSERT INTO public.med_dose_events (
    person_id,
    regimen_id,
    scheduled_at,
    actual_at,
    planned_intake,
    status,
    taken_at,
    note
  )
  SELECT
    m.person_id,
    m.regimen_id,
    m.scheduled_at,
    m.scheduled_at,
    m.planned_intake,
    'taken'::public.med_dose_event_status,
    m.scheduled_at,
    prm.backfill_note
  FROM missing m
  CROSS JOIN pg_temp._demi_backfill_params prm
  RETURNING id, regimen_id, scheduled_at, planned_intake
)
INSERT INTO pg_temp._demi_backfill_inserted_events (event_id, regimen_id, scheduled_at, planned_intake)
SELECT id, regimen_id, scheduled_at, planned_intake
FROM inserted;

WITH tx_rows AS (
  INSERT INTO public.med_inventory_transactions (
    regimen_id,
    event_id,
    type,
    amount,
    unit,
    note
  )
  SELECT
    i.regimen_id,
    i.event_id,
    'decrement'::public.med_inventory_transaction_type,
    COALESCE(NULLIF(i.planned_intake->'intake'->>'amount', '')::numeric, 1),
    COALESCE(i.planned_intake->'intake'->>'unit', r.intake_unit::text, 'pill'),
    prm.backfill_note
  FROM pg_temp._demi_backfill_inserted_events i
  JOIN public.med_regimens r ON r.id = i.regimen_id
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE COALESCE((r.inventory->>'enabled')::boolean, false)
    AND COALESCE((r.inventory->>'auto_decrement_on_taken')::boolean, false)
  RETURNING regimen_id, amount
),
agg AS (
  SELECT regimen_id, sum(amount) AS decremented_amount
  FROM tx_rows
  GROUP BY regimen_id
)
INSERT INTO pg_temp._demi_backfill_inventory_deltas (regimen_id, decremented_amount)
SELECT regimen_id, decremented_amount
FROM agg
ON CONFLICT (regimen_id) DO UPDATE
SET decremented_amount = EXCLUDED.decremented_amount;

UPDATE public.med_regimens r
SET
  inventory = jsonb_set(
    COALESCE(r.inventory, '{}'::jsonb),
    '{current_amount}',
    to_jsonb(
      GREATEST(
        0,
        COALESCE(NULLIF(r.inventory->>'current_amount', '')::numeric, 0) - d.decremented_amount
      )
    ),
    true
  ),
  updated_at = now()
FROM pg_temp._demi_backfill_inventory_deltas d
WHERE r.id = d.regimen_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- Postcheck
-- ---------------------------------------------------------------------------
SELECT
  i.regimen_id,
  count(*)::bigint AS inserted_event_count,
  min(i.scheduled_at) AS first_inserted_scheduled_at,
  max(i.scheduled_at) AS last_inserted_scheduled_at
FROM pg_temp._demi_backfill_inserted_events i
GROUP BY i.regimen_id
ORDER BY i.regimen_id;

SELECT
  d.regimen_id,
  d.decremented_amount
FROM pg_temp._demi_backfill_inventory_deltas d
ORDER BY d.regimen_id;

WITH ctx AS (
  SELECT p.id AS person_id
  FROM public.persons p
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE lower(trim(p.name)) = lower(trim(prm.person_name))
    AND p.kind::text = prm.person_kind
),
window_events AS (
  SELECT
    e.regimen_id,
    date_trunc('minute', e.scheduled_at) AS scheduled_minute,
    count(*)::int AS row_count
  FROM public.med_dose_events e
  JOIN ctx ON ctx.person_id = e.person_id
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE e.scheduled_at >= prm.start_at
    AND e.scheduled_at <= prm.end_at
  GROUP BY e.regimen_id, date_trunc('minute', e.scheduled_at)
),
duplicates AS (
  SELECT regimen_id, scheduled_minute, row_count
  FROM window_events
  WHERE row_count > 1
)
SELECT
  count(*)::bigint AS duplicate_regimen_minute_rows,
  CASE WHEN count(*) = 0 THEN 'ok' ELSE 'check' END AS duplicate_check
FROM duplicates;

WITH ctx AS (
  SELECT p.id AS person_id
  FROM public.persons p
  CROSS JOIN pg_temp._demi_backfill_params prm
  WHERE lower(trim(p.name)) = lower(trim(prm.person_name))
    AND p.kind::text = prm.person_kind
)
SELECT
  EXISTS (
    SELECT 1
    FROM public.med_dose_events e
    JOIN ctx ON ctx.person_id = e.person_id
    WHERE e.scheduled_at > now()
  ) AS has_future_events_after_repair;
