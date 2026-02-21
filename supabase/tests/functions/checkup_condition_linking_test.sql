BEGIN;
SELECT plan(6);

SELECT has_function('public', 'get_checkups_for_condition', ARRAY['uuid']);

INSERT INTO public.persons (id, name, kind)
VALUES ('d4040404-0000-0000-0000-000000000004', 'Checkup Person', 'human');

INSERT INTO public.conditions (id, person_id, name, current_status)
VALUES
  ('e5050505-0000-0000-0000-000000000005', 'd4040404-0000-0000-0000-000000000004', 'Condition A', 'active'),
  ('f6060606-0000-0000-0000-000000000006', 'd4040404-0000-0000-0000-000000000004', 'Condition B', 'active');

INSERT INTO public.checkup_items (
  id,
  person_id,
  title,
  category,
  schedule,
  why_links
)
VALUES
  (
    '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'd4040404-0000-0000-0000-000000000004',
    'Condition A Follow-up (later)',
    'lab',
    '{"type":"one_off","due_at":"2026-02-10"}'::jsonb,
    '[{"type":"condition","id":"e5050505-0000-0000-0000-000000000005"}]'::jsonb
  ),
  (
    '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    'd4040404-0000-0000-0000-000000000004',
    'Condition A Follow-up (earlier)',
    'lab',
    '{"type":"one_off","due_at":"2026-02-01"}'::jsonb,
    '[{"type":"condition","id":"e5050505-0000-0000-0000-000000000005"}]'::jsonb
  ),
  (
    '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
    'd4040404-0000-0000-0000-000000000004',
    'Condition B Follow-up',
    'imaging',
    '{"type":"one_off","due_at":"2026-02-03"}'::jsonb,
    '[{"type":"condition","id":"f6060606-0000-0000-0000-000000000006"}]'::jsonb
  );

SELECT is(
  (
    SELECT count(*)
    FROM public.get_checkups_for_condition('e5050505-0000-0000-0000-000000000005')
  ),
  2::bigint,
  'get_checkups_for_condition returns only rows linked to the requested condition'
);

SELECT is(
  (
    SELECT id::text
    FROM public.get_checkups_for_condition('e5050505-0000-0000-0000-000000000005')
    LIMIT 1 OFFSET 0
  ),
  '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  'get_checkups_for_condition orders by next_due_at ascending (first row)'
);

SELECT is(
  (
    SELECT id::text
    FROM public.get_checkups_for_condition('e5050505-0000-0000-0000-000000000005')
    LIMIT 1 OFFSET 1
  ),
  '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'get_checkups_for_condition orders by next_due_at ascending (second row)'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_checkups_for_condition('f6060606-0000-0000-0000-000000000006')
  ),
  1::bigint,
  'get_checkups_for_condition isolates rows for a different condition id'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.get_checkups_for_condition('00000000-0000-0000-0000-000000000000')
  ),
  0::bigint,
  'get_checkups_for_condition returns empty set when no links match'
);

SELECT * FROM finish();
ROLLBACK;
