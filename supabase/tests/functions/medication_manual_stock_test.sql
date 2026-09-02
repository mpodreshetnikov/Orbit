BEGIN;
SELECT plan(4);

-- A course whose stock is tracked but kept by hand: `enabled` is on so the
-- figure and its refill threshold exist, `auto_decrement_on_taken` is off so
-- resolving a dose never touches the number. Nothing that resolves a dose may
-- move `current_amount` here -- and the reversals used to, which only ever
-- raised it and so held it above the threshold the refill reminder fires on.

INSERT INTO auth.users (id, email, aud, role)
VALUES ('11111111-1111-1111-1111-111111111111', 'manual-stock@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Manual Stock Person',
  'human',
  '11111111-1111-1111-1111-111111111111'
);

INSERT INTO public.med_regimens (
  id,
  person_id,
  custom_name,
  schedule,
  duration,
  dose_definition,
  inventory
)
VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Hand Counted',
  '{"mode":"daily_times","times":["09:00"],"amounts":[1]}'::jsonb,
  '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
  '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
  '{"enabled":true,"auto_decrement_on_taken":false,"current_amount":10,"refill_threshold_amount":2,"unit":"pill"}'::jsonb
);

INSERT INTO public.med_dose_events (
  id,
  person_id,
  regimen_id,
  scheduled_at,
  actual_at,
  planned_intake,
  status
)
VALUES
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    now() + interval '1 hour',
    now() + interval '1 hour',
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    now() + interval '2 hours',
    now() + interval '2 hours',
    '{"intake":{"amount":1,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'
  );

SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

SELECT public.mark_dose_taken('cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  10::numeric,
  'mark_dose_taken leaves stock alone when automatic decrementing is off'
);

-- The ledger still records what was asked for; only the running figure is the
-- owner's to move.
SELECT is(
  (
    SELECT count(*)
    FROM public.med_inventory_transactions
    WHERE regimen_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND type = 'decrement'
  ),
  1::bigint,
  'mark_dose_taken still writes the decrement transaction'
);

SELECT public.mark_dose_skipped('cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  10::numeric,
  'mark_dose_skipped restores nothing when the intake took nothing'
);

SELECT public.mark_dose_taken('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT public.undo_dose_intake('dddddddd-dddd-dddd-dddd-dddddddddddd');

SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  10::numeric,
  'undo_dose_intake restores nothing when the intake took nothing'
);

SELECT * FROM finish();
ROLLBACK;
