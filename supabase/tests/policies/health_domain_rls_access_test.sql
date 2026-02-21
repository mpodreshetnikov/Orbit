BEGIN;
SELECT plan(10);

INSERT INTO auth.users (id, email, aud, role)
VALUES (
  '10101010-2020-3030-4040-505050505050',
  'health-pass@example.com',
  'authenticated',
  'authenticated'
);

INSERT INTO public.allowed_users (email)
VALUES ('health-pass@example.com');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '61616161-7272-8383-9494-050505050505',
  'Health Domain Person',
  'human',
  '10101010-2020-3030-4040-505050505050'
);

INSERT INTO public.medical_records (
  id,
  person_id,
  created_by_user_id,
  record_type,
  record_date,
  title,
  status
)
VALUES (
  '71717171-8282-9393-0404-151515151515',
  '61616161-7272-8383-9494-050505050505',
  '10101010-2020-3030-4040-505050505050',
  'lab',
  '2026-02-01'::date,
  'Health Domain Record',
  'active'
);

INSERT INTO public.conditions (
  id,
  person_id,
  name,
  current_status
)
VALUES (
  '81818181-9292-0303-1414-252525252525',
  '61616161-7272-8383-9494-050505050505',
  'Health Domain Condition',
  'active'
);

INSERT INTO public.condition_records (
  condition_id,
  record_id,
  status_in_record,
  source_anchor,
  confidence
)
VALUES (
  '81818181-9292-0303-1414-252525252525',
  '71717171-8282-9393-0404-151515151515',
  'active',
  'domain-anchor',
  0.9
);

INSERT INTO public.checkup_items (
  id,
  person_id,
  title,
  category,
  schedule
)
VALUES (
  '91919191-0202-1313-2424-353535353535',
  '61616161-7272-8383-9494-050505050505',
  'Health Domain Checkup',
  'lab',
  '{"type":"one_off","due_at":"2026-02-10"}'::jsonb
);

INSERT INTO public.checkup_completions (
  checkup_item_id,
  done_at,
  note
)
VALUES (
  '91919191-0202-1313-2424-353535353535',
  '2026-02-05'::date,
  'completed in policy test'
);

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.email', 'health-pass@example.com', true);

SELECT is(
  (SELECT count(*) FROM public.conditions WHERE id = '81818181-9292-0303-1414-252525252525'),
  1::bigint,
  'allowlisted user can read conditions row'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.condition_records
    WHERE condition_id = '81818181-9292-0303-1414-252525252525'
      AND record_id = '71717171-8282-9393-0404-151515151515'
  ),
  1::bigint,
  'allowlisted user can read condition_records row'
);

SELECT is(
  (SELECT count(*) FROM public.checkup_items WHERE id = '91919191-0202-1313-2424-353535353535'),
  1::bigint,
  'allowlisted user can read checkup_items row'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.checkup_completions
    WHERE checkup_item_id = '91919191-0202-1313-2424-353535353535'
  ),
  1::bigint,
  'allowlisted user can read checkup_completions row'
);

SELECT set_config('request.jwt.claim.email', 'health-deny@example.com', true);

SELECT is(
  (SELECT count(*) FROM public.conditions WHERE id = '81818181-9292-0303-1414-252525252525'),
  0::bigint,
  'non-allowlisted user cannot read conditions row'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.condition_records
    WHERE condition_id = '81818181-9292-0303-1414-252525252525'
      AND record_id = '71717171-8282-9393-0404-151515151515'
  ),
  0::bigint,
  'non-allowlisted user cannot read condition_records row'
);

SELECT is(
  (SELECT count(*) FROM public.checkup_items WHERE id = '91919191-0202-1313-2424-353535353535'),
  0::bigint,
  'non-allowlisted user cannot read checkup_items row'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.checkup_completions
    WHERE checkup_item_id = '91919191-0202-1313-2424-353535353535'
  ),
  0::bigint,
  'non-allowlisted user cannot read checkup_completions row'
);

SELECT throws_ok(
  $$
    INSERT INTO public.conditions (person_id, name, current_status)
    VALUES (
      '61616161-7272-8383-9494-050505050505',
      'Forbidden Insert Condition',
      'active'
    )
  $$,
  'new row violates row-level security policy for table "conditions"',
  'non-allowlisted user cannot insert into conditions'
);

SELECT throws_ok(
  $$
    INSERT INTO public.checkup_items (person_id, title, category, schedule)
    VALUES (
      '61616161-7272-8383-9494-050505050505',
      'Forbidden Checkup Insert',
      'lab',
      '{"type":"one_off","due_at":"2026-03-01"}'::jsonb
    )
  $$,
  'new row violates row-level security policy for table "checkup_items"',
  'non-allowlisted user cannot insert into checkup_items'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
