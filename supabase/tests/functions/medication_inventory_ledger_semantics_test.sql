BEGIN;
SELECT plan(8);

-- The ledger records what moved, not what was asked for (T-260901-pou). A dose
-- taken with automatic decrementing on, the flag then cleared, and the dose
-- corrected to skipped must restore stock from the ledger row — not from the
-- regimen settings that no longer match the intake.

INSERT INTO auth.users (id, email, aud, role)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'ledger-semantics@example.com',
  'authenticated',
  'authenticated'
);

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Ledger Semantics Person',
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
  'Auto Then Manual',
  '{"mode":"daily_times","times":["09:00"],"amounts":[2]}'::jsonb,
  '{"type":"ongoing","start_date":"2026-01-01"}'::jsonb,
  '{"intake":{"amount":2,"unit":"pill"},"active":[]}'::jsonb,
  '{"enabled":true,"auto_decrement_on_taken":true,"current_amount":10,"refill_threshold_amount":2,"unit":"pill"}'::jsonb
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
    '{"intake":{"amount":2,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    now() + interval '2 hours',
    now() + interval '2 hours',
    '{"intake":{"amount":2,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'
  ),
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    now() + interval '3 hours',
    now() + interval '3 hours',
    '{"intake":{"amount":2,"unit":"pill"},"active":[]}'::jsonb,
    'scheduled'
  );

SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

SELECT public.mark_dose_taken('cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  8::numeric,
  'intake with auto decrement on reduces stock'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.med_inventory_transactions
    WHERE event_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND type = 'decrement'
  ),
  1::bigint,
  'intake that moved stock writes a decrement row'
);

-- Clear the flag after the intake that really took stock out.
UPDATE public.med_regimens
SET inventory = jsonb_set(inventory, '{auto_decrement_on_taken}', 'false'::jsonb, true),
    updated_at = now()
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT public.mark_dose_skipped('cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  10::numeric,
  'skip restores stock from the ledger after auto decrement was cleared'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.med_inventory_transactions
    WHERE event_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND type = 'correction'
  ),
  1::bigint,
  'skip writes a correction only because the ledger shows stock moved'
);

-- Same path via undo: take with auto on, clear the flag, undo.
UPDATE public.med_regimens
SET inventory = jsonb_set(
      jsonb_set(inventory, '{auto_decrement_on_taken}', 'true'::jsonb, true),
      '{current_amount}',
      '10'::jsonb,
      true
    ),
    updated_at = now()
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT public.mark_dose_taken('dddddddd-dddd-dddd-dddd-dddddddddddd');

UPDATE public.med_regimens
SET inventory = jsonb_set(inventory, '{auto_decrement_on_taken}', 'false'::jsonb, true),
    updated_at = now()
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT public.undo_dose_intake('dddddddd-dddd-dddd-dddd-dddddddddddd');

SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  10::numeric,
  'undo restores stock from the ledger after auto decrement was cleared'
);

-- Amount edit: take with auto on, clear the flag, edit amount — reverse the
-- moved stock and do not apply a new decrement under the cleared flag.
UPDATE public.med_regimens
SET inventory = jsonb_set(
      jsonb_set(inventory, '{auto_decrement_on_taken}', 'true'::jsonb, true),
      '{current_amount}',
      '10'::jsonb,
      true
    ),
    updated_at = now()
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT public.mark_dose_taken('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

UPDATE public.med_regimens
SET inventory = jsonb_set(inventory, '{auto_decrement_on_taken}', 'false'::jsonb, true),
    updated_at = now()
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT public.update_dose_event_resolution_details(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  NULL,
  1,
  NULL
);

SELECT is(
  (SELECT (inventory->>'current_amount')::numeric FROM public.med_regimens WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  10::numeric,
  'amount edit restores moved stock and applies no new decrement after flag cleared'
);
SELECT is(
  (
    SELECT (planned_intake->'intake'->>'amount')::numeric
    FROM public.med_dose_events
    WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  ),
  1::numeric,
  'amount edit still rewrites the taken amount when stock is not re-applied'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.med_inventory_transactions
    WHERE event_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
      AND type = 'decrement'
  ),
  1::bigint,
  'amount edit after flag cleared leaves only the original decrement (plus correction)'
);

SELECT * FROM finish();
ROLLBACK;
