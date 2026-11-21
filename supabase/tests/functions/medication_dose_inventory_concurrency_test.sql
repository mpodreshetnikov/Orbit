-- Concurrent races for dose resolution and inventory writes (T-0020).
-- Uses dblink async sessions so two callers truly overlap; setup/cleanup commit
-- on those sessions because an outer ROLLBACK would hide rows from them.

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT plan(6);

CREATE OR REPLACE FUNCTION pg_temp.t0020_conn(p_name text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_addr inet := inet_server_addr();
  v_port int := inet_server_port();
BEGIN
  IF v_addr IS NULL OR v_port IS NULL THEN
    RAISE EXCEPTION 't0020_conn: inet_server_addr/port unavailable for dblink';
  END IF;
  PERFORM extensions.dblink_connect(
    p_name,
    format(
      'host=%s port=%s dbname=postgres user=postgres password=postgres',
      host(v_addr),
      v_port
    )
  );
  RETURN p_name;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.t0020_drain(p_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  LOOP
    SELECT * INTO r FROM extensions.dblink_get_result(p_name) AS t(x text);
    EXIT WHEN NOT FOUND;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.t0020_cleanup()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM extensions.dblink_exec(
    'setup',
    $remote$
      DELETE FROM public.med_inventory_transactions
      WHERE regimen_id IN (
        'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbbbbb',
        'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbccc1'
      );
      DELETE FROM public.med_dose_events
      WHERE id = 'cccccccc-0020-cccc-cccc-cccccccccccc';
      DELETE FROM public.med_regimens
      WHERE id IN (
        'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbbbbb',
        'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbccc1'
      );
      DELETE FROM public.persons
      WHERE id = 'aaaaaaaa-0020-aaaa-aaaa-aaaaaaaaaaaa';
      DELETE FROM auth.users
      WHERE id = '11111111-0020-1111-1111-111111111111';
    $remote$
  );
END;
$$;

SELECT pg_temp.t0020_conn('setup');
SELECT pg_temp.t0020_conn('s1');
SELECT pg_temp.t0020_conn('s2');

SELECT pg_temp.t0020_cleanup();

SELECT extensions.dblink_exec(
  'setup',
  $remote$
    INSERT INTO auth.users (id, email, aud, role)
    VALUES (
      '11111111-0020-1111-1111-111111111111',
      'dose-race@example.com',
      'authenticated',
      'authenticated'
    );

    INSERT INTO public.persons (id, name, kind, auth_user_id)
    VALUES (
      'aaaaaaaa-0020-aaaa-aaaa-aaaaaaaaaaaa',
      'Dose Race Person',
      'human',
      '11111111-0020-1111-1111-111111111111'
    );

    INSERT INTO public.med_regimens (
      id, person_id, custom_name, schedule, duration, dose_definition, inventory
    ) VALUES (
      'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbbbbb',
      'aaaaaaaa-0020-aaaa-aaaa-aaaaaaaaaaaa',
      'Race Med',
      '{"mode":"daily_times","times":["09:00"],"amounts":[1]}'::jsonb,
      '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
      '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
      '{"enabled":true,"auto_decrement_on_taken":true,"current_amount":10,"refill_threshold_amount":2,"unit":"pill"}'::jsonb
    );

    INSERT INTO public.med_dose_events (
      id, person_id, regimen_id, scheduled_at, actual_at, planned_intake, status
    ) VALUES (
      'cccccccc-0020-cccc-cccc-cccccccccccc',
      'aaaaaaaa-0020-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbbbbb',
      now() + interval '1 hour',
      now() + interval '1 hour',
      '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
      'scheduled'
    );

    INSERT INTO public.med_regimens (
      id, person_id, custom_name, schedule, duration, dose_definition, inventory
    ) VALUES (
      'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbccc1',
      'aaaaaaaa-0020-aaaa-aaaa-aaaaaaaaaaaa',
      'Inventory Race Med',
      '{"mode":"daily_times","times":["09:00"],"amounts":[1]}'::jsonb,
      '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
      '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
      '{"enabled":true,"auto_decrement_on_taken":true,"current_amount":10,"refill_threshold_amount":2,"unit":"pill","note":"keep-me"}'::jsonb
    );
  $remote$
);

SELECT *
FROM extensions.dblink(
  's1',
  $$SELECT set_config('request.jwt.claim.sub', '11111111-0020-1111-1111-111111111111', false)$$
) AS t(x text);
SELECT *
FROM extensions.dblink(
  's2',
  $$SELECT set_config('request.jwt.claim.sub', '11111111-0020-1111-1111-111111111111', false)$$
) AS t(x text);

-- Race 1: two concurrent mark_dose_taken on the same event.
SELECT extensions.dblink_send_query(
  's1',
  $$SELECT public.mark_dose_taken('cccccccc-0020-cccc-cccc-cccccccccccc')$$
);
SELECT extensions.dblink_send_query(
  's2',
  $$SELECT public.mark_dose_taken('cccccccc-0020-cccc-cccc-cccccccccccc')$$
);
SELECT pg_temp.t0020_drain('s1');
SELECT pg_temp.t0020_drain('s2');

SELECT is(
  (SELECT status::text FROM public.med_dose_events WHERE id = 'cccccccc-0020-cccc-cccc-cccccccccccc'),
  'taken',
  'concurrent mark_dose_taken leaves event taken once'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.med_inventory_transactions
    WHERE event_id = 'cccccccc-0020-cccc-cccc-cccccccccccc'
      AND type = 'decrement'
  ),
  1::bigint,
  'concurrent mark_dose_taken writes exactly one decrement transaction'
);

SELECT is(
  (
    SELECT (inventory->>'current_amount')::numeric
    FROM public.med_regimens
    WHERE id = 'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbbbbb'
  ),
  9::numeric,
  'concurrent mark_dose_taken decrements inventory once'
);

-- Race 2: two concurrent inventory writers must not lose an update.
SELECT extensions.dblink_send_query(
  's1',
  $$SELECT public.update_regimen_inventory(
    'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbccc1',
    'refill',
    5,
    'race-a'
  )$$
);
SELECT extensions.dblink_send_query(
  's2',
  $$SELECT public.update_regimen_inventory(
    'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbccc1',
    'refill',
    5,
    'race-b'
  )$$
);
SELECT pg_temp.t0020_drain('s1');
SELECT pg_temp.t0020_drain('s2');

SELECT is(
  (
    SELECT (inventory->>'current_amount')::numeric
    FROM public.med_regimens
    WHERE id = 'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbccc1'
  ),
  20::numeric,
  'concurrent update_regimen_inventory keeps both refill amounts'
);

SELECT is(
  (
    SELECT inventory->>'note'
    FROM public.med_regimens
    WHERE id = 'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbccc1'
  ),
  'keep-me',
  'concurrent inventory writers preserve unrelated inventory fields'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.med_inventory_transactions
    WHERE regimen_id = 'bbbbbbbb-0020-bbbb-bbbb-bbbbbbbbccc1'
      AND type = 'refill'
  ),
  2::bigint,
  'concurrent update_regimen_inventory writes both refill transactions'
);

SELECT pg_temp.t0020_cleanup();

SELECT extensions.dblink_disconnect('s1');
SELECT extensions.dblink_disconnect('s2');
SELECT extensions.dblink_disconnect('setup');

SELECT * FROM finish();
