BEGIN;
SELECT plan(18);

SELECT has_function(
  'public',
  'get_medication_dose_reminder_payload_for_person',
  ARRAY['uuid', 'timestamp with time zone', 'text']
);
SELECT has_function('public', 'create_medication_reminder_digests', ARRAY['timestamp with time zone']);

CREATE TEMP TABLE _vars AS
SELECT
  '2026-03-01 12:00:00+00'::timestamptz AS now_utc,
  '2026-03-01 11:35:00+00'::timestamptz AS overdue_25m,
  '2026-03-01 11:40:00+00'::timestamptz AS overdue_20m,
  '2026-02-28 23:50:00+00'::timestamptz AS previous_day_2350;

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('91000000-0000-0000-0000-000000000001', 'reminder-owner@example.com', 'authenticated', 'authenticated'),
  ('91000000-0000-0000-0000-000000000002', 'reminder-caregiver@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '92000000-0000-0000-0000-000000000001',
  'Reminder Person',
  'human',
  '91000000-0000-0000-0000-000000000001'
);

INSERT INTO public.notification_routing (recipient_user_id, person_id, enabled, custom_prefix)
VALUES (
  '91000000-0000-0000-0000-000000000002',
  '92000000-0000-0000-0000-000000000001',
  true,
  'Care Prefix'
);

INSERT INTO public.user_preferences (auth_user_id, checkup_notification_timezone, overdue_reminder_interval_minutes)
VALUES
  ('91000000-0000-0000-0000-000000000001', 'UTC', 15),
  ('91000000-0000-0000-0000-000000000002', 'UTC', 15);

INSERT INTO public.med_regimens (
  id,
  person_id,
  custom_name,
  status,
  schedule,
  duration,
  dose_definition
)
SELECT
  r.id,
  '92000000-0000-0000-0000-000000000001'::uuid,
  r.custom_name,
  r.status::public.medication_status,
  r.schedule,
  '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
  '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb
FROM _vars v
CROSS JOIN (
  VALUES
    (
      '93000000-0000-0000-0000-000000000001'::uuid,
      'Reminder Active OneOff',
      'active',
      '{"mode":"one_off","due_at":"2026-03-01T12:00:00+00"}'::jsonb
    ),
    (
      '93000000-0000-0000-0000-000000000002'::uuid,
      'Reminder Active IntervalHours',
      'active',
      '{"mode":"interval_hours","interval":{"every":6},"amount":1}'::jsonb
    ),
    (
      '93000000-0000-0000-0000-000000000003'::uuid,
      'Reminder Active Daily',
      'active',
      '{"mode":"daily_times","times":["12:00"],"amounts":[1]}'::jsonb
    ),
    (
      '93000000-0000-0000-0000-000000000004'::uuid,
      'Reminder Active DOW',
      'active',
      '{"mode":"days_of_week","days_of_week":[0,1,2,3,4,5,6],"times":["12:00"],"amounts":[1]}'::jsonb
    ),
    (
      '93000000-0000-0000-0000-000000000005'::uuid,
      'Reminder Active IntervalDays',
      'active',
      '{"mode":"interval_days","interval":{"every":1},"times":["12:00"],"amounts":[1]}'::jsonb
    ),
    (
      '93000000-0000-0000-0000-000000000006'::uuid,
      'Reminder Paused',
      'paused',
      '{"mode":"daily_times","times":["12:00"],"amounts":[1]}'::jsonb
    ),
    (
      '93000000-0000-0000-0000-000000000007'::uuid,
      'Reminder Completed',
      'completed',
      '{"mode":"daily_times","times":["12:00"],"amounts":[1]}'::jsonb
    ),
    (
      '93000000-0000-0000-0000-000000000008'::uuid,
      'Reminder Archived',
      'archived',
      '{"mode":"daily_times","times":["12:00"],"amounts":[1]}'::jsonb
    ),
    (
      '93000000-0000-0000-0000-000000000009'::uuid,
      'Reminder Deleted',
      'active',
      '{"mode":"daily_times","times":["12:00"],"amounts":[1]}'::jsonb
    )
) AS r(id, custom_name, status, schedule);

UPDATE public.med_regimens
SET deleted_at = now()
WHERE id = '93000000-0000-0000-0000-000000000009';

INSERT INTO public.med_dose_events (
  id,
  person_id,
  regimen_id,
  scheduled_at,
  actual_at,
  planned_intake,
  status,
  taken_at
)
SELECT * FROM (
  SELECT
    '94000000-0000-0000-0000-000000000001'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000002'::uuid,
    v.now_utc,
    v.now_utc,
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000002'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000003'::uuid,
    v.overdue_25m,
    v.overdue_25m,
    '{"intake":{"amount":2,"unit":"ml"},"active":[]}'::jsonb,
    'sent'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000003'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000004'::uuid,
    v.now_utc + interval '30 seconds',
    v.now_utc + interval '30 seconds',
    '{"intake":{"amount":1,"unit":"capsule"},"active":[]}'::jsonb,
    'scheduled'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000004'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000005'::uuid,
    v.overdue_20m,
    v.overdue_20m,
    '{"intake":{"amount":3,"unit":"drop"},"active":[]}'::jsonb,
    'sent'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000005'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000001'::uuid,
    v.now_utc,
    v.now_utc,
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'taken'::public.med_dose_event_status,
    v.now_utc
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000006'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000006'::uuid,
    v.now_utc,
    v.now_utc,
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000007'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000007'::uuid,
    v.overdue_25m,
    v.overdue_25m,
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'sent'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000008'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000008'::uuid,
    v.now_utc,
    v.now_utc,
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000009'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000009'::uuid,
    v.now_utc,
    v.now_utc,
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000010'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000003'::uuid,
    v.now_utc + interval '2 minutes',
    v.now_utc + interval '2 minutes',
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'taken'::public.med_dose_event_status,
    v.now_utc + interval '2 minutes'
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000011'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000003'::uuid,
    v.now_utc + interval '3 minutes',
    v.now_utc + interval '3 minutes',
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'skipped'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000012'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000003'::uuid,
    v.now_utc + interval '4 minutes',
    v.now_utc + interval '4 minutes',
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'snoozed'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000013'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000003'::uuid,
    v.now_utc + interval '5 minutes',
    v.now_utc + interval '5 minutes',
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'missed'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000014'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000003'::uuid,
    v.now_utc + interval '6 minutes',
    v.now_utc + interval '6 minutes',
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'cancelled'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
  UNION ALL
  SELECT
    '94000000-0000-0000-0000-000000000015'::uuid,
    '92000000-0000-0000-0000-000000000001'::uuid,
    '93000000-0000-0000-0000-000000000002'::uuid,
    v.previous_day_2350,
    v.previous_day_2350,
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'sent'::public.med_dose_event_status,
    NULL::timestamptz
  FROM _vars v
) AS seeded_events;

SELECT is(
  (
    SELECT count(*)
    FROM public.get_medication_dose_reminder_payload_for_person(
      '92000000-0000-0000-0000-000000000001',
      (SELECT now_utc FROM _vars),
      'UTC'
    )
  ),
  4::bigint,
  'payload returns only active/scheduled-or-sent due+overdue-today events across schedule modes'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_medication_dose_reminder_payload_for_person(
      '92000000-0000-0000-0000-000000000001',
      (SELECT now_utc FROM _vars) - interval '1 minute',
      'UTC'
    ) AS p
    WHERE p.dose_event_id = '94000000-0000-0000-0000-000000000001'::uuid
  ),
  0::bigint,
  'payload does not include scheduled dose one minute before intake minute'
);

SELECT ok(
  (
    SELECT array_agg(p.medication_name ORDER BY p.medication_name)
    FROM public.get_medication_dose_reminder_payload_for_person(
      '92000000-0000-0000-0000-000000000001',
      (SELECT now_utc FROM _vars),
      'UTC'
    ) AS p
  ) = ARRAY[
    'Reminder Active Daily',
    'Reminder Active DOW',
    'Reminder Active IntervalDays',
    'Reminder Active IntervalHours'
  ]::text[],
  'payload includes expected active regimen schedule modes'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_medication_dose_reminder_payload_for_person(
      '92000000-0000-0000-0000-000000000001',
      (SELECT now_utc FROM _vars),
      'UTC'
    ) AS p
    WHERE p.medication_name IN ('Reminder Paused', 'Reminder Completed', 'Reminder Archived', 'Reminder Deleted')
  ),
  0::bigint,
  'payload excludes paused/completed/archived/deleted regimens'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_medication_dose_reminder_payload_for_person(
      '92000000-0000-0000-0000-000000000001',
      (SELECT now_utc FROM _vars),
      'UTC'
    ) AS p
    WHERE p.dose_event_id IN (
      '94000000-0000-0000-0000-000000000010'::uuid,
      '94000000-0000-0000-0000-000000000011'::uuid,
      '94000000-0000-0000-0000-000000000012'::uuid,
      '94000000-0000-0000-0000-000000000013'::uuid,
      '94000000-0000-0000-0000-000000000014'::uuid
    )
  ),
  0::bigint,
  'payload excludes taken/skipped/snoozed/missed/cancelled event statuses'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_medication_dose_reminder_payload_for_person(
      '92000000-0000-0000-0000-000000000001',
      (SELECT now_utc FROM _vars),
      'UTC'
    ) AS p
    WHERE p.medication_name = 'Reminder Active OneOff'
  ),
  0::bigint,
  'payload excludes one_off regimen event when its dose is already taken'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_medication_dose_reminder_payload_for_person(
      '92000000-0000-0000-0000-000000000001',
      (SELECT now_utc FROM _vars),
      'UTC'
    ) AS p
    WHERE p.dose_event_id = '94000000-0000-0000-0000-000000000015'::uuid
  ),
  0::bigint,
  'payload excludes overdue doses from previous day'
);

SELECT public.create_medication_reminder_digests((SELECT now_utc FROM _vars));

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE type = 'medication'
      AND person_id = '92000000-0000-0000-0000-000000000001'
  ),
  2::bigint,
  'digest creator writes one medication digest per recipient (owner + caregiver)'
);

SELECT is(
  (
    SELECT jsonb_array_length(payload_json->'doses')
    FROM public.notification_digests
    WHERE type = 'medication'
      AND auth_user_id = '91000000-0000-0000-0000-000000000001'
      AND person_id = '92000000-0000-0000-0000-000000000001'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  4,
  'owner digest contains all due/overdue active-mode doses'
);

SELECT is(
  (
    SELECT jsonb_array_length(payload_json->'doses')
    FROM public.notification_digests
    WHERE type = 'medication'
      AND auth_user_id = '91000000-0000-0000-0000-000000000002'
      AND person_id = '92000000-0000-0000-0000-000000000001'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  4,
  'caregiver digest contains same dose set'
);

SELECT is(
  (
    SELECT payload_json->>'title_prefix'
    FROM public.notification_digests
    WHERE type = 'medication'
      AND auth_user_id = '91000000-0000-0000-0000-000000000002'
      AND person_id = '92000000-0000-0000-0000-000000000001'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  'Care Prefix',
  'caregiver digest uses routing custom_prefix'
);

SELECT ok(
  (
    SELECT payload_json->>'title_prefix' IS NULL
    FROM public.notification_digests
    WHERE type = 'medication'
      AND auth_user_id = '91000000-0000-0000-0000-000000000001'
      AND person_id = '92000000-0000-0000-0000-000000000001'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  'owner digest omits title_prefix'
);

SELECT is(
  (
    SELECT count(*)
    FROM (
      SELECT dose
      FROM (
        SELECT d.payload_json
        FROM public.notification_digests d
        WHERE d.type = 'medication'
          AND d.auth_user_id = '91000000-0000-0000-0000-000000000001'
          AND d.person_id = '92000000-0000-0000-0000-000000000001'
        ORDER BY d.created_at DESC
        LIMIT 1
      ) AS latest
      CROSS JOIN LATERAL jsonb_array_elements(latest.payload_json->'doses') AS dose
    ) AS owner_dose_rows
    WHERE COALESCE((owner_dose_rows.dose->>'is_overdue_reminder')::boolean, false)
  ),
  2::bigint,
  'owner digest flags overdue doses using overdue reminder marker'
);

SELECT is(
  (
    SELECT scheduled_at
    FROM public.notification_digests
    WHERE type = 'medication'
      AND auth_user_id = '91000000-0000-0000-0000-000000000001'
      AND person_id = '92000000-0000-0000-0000-000000000001'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  (SELECT overdue_25m FROM _vars),
  'digest scheduled_at is the earliest scheduled_at among included doses'
);

SELECT ok(
  (
    SELECT array_agg(owner_dose_rows.dose->>'medication_name' ORDER BY owner_dose_rows.dose->>'medication_name')
    FROM (
      SELECT dose
      FROM (
        SELECT d.payload_json
        FROM public.notification_digests d
        WHERE d.type = 'medication'
          AND d.auth_user_id = '91000000-0000-0000-0000-000000000001'
          AND d.person_id = '92000000-0000-0000-0000-000000000001'
        ORDER BY d.created_at DESC
        LIMIT 1
      ) AS latest
      CROSS JOIN LATERAL jsonb_array_elements(latest.payload_json->'doses') AS dose
    ) AS owner_dose_rows
  ) = ARRAY[
    'Reminder Active Daily',
    'Reminder Active DOW',
    'Reminder Active IntervalDays',
    'Reminder Active IntervalHours'
  ]::text[],
  'digest dose payload preserves schedule-mode coverage set'
);

SELECT public.create_medication_reminder_digests((SELECT now_utc FROM _vars));

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE type = 'medication'
      AND person_id = '92000000-0000-0000-0000-000000000001'
  ),
  2::bigint,
  'second digest run stays idempotent for unsent dose_event_ids'
);

SELECT * FROM finish();
ROLLBACK;
