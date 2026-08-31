BEGIN;
SELECT plan(6);

SELECT has_function(
  'public',
  'claim_medical_record',
  ARRAY['uuid', 'uuid', 'text', 'integer'],
  'the pipeline claim exists as one database statement'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES (
  '77777777-3333-0000-0000-000000000000',
  'claim-user@example.com',
  'authenticated',
  'authenticated'
);

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('77777777-3333-0000-0000-000000000000', 'claim-user@example.com');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '88888888-3333-0000-0000-000000000000',
  'Claim Person',
  'human',
  '77777777-3333-0000-0000-000000000000'
);

INSERT INTO public.medical_records (
  id, person_id, created_by_user_id, record_type, record_date, title, status
)
VALUES (
  '99999999-3333-0000-0000-000000000000',
  '88888888-3333-0000-0000-000000000000',
  '77777777-3333-0000-0000-000000000000',
  'lab',
  '2026-02-01'::date,
  'Panel',
  'ocr_review'
);

-- An unclaimed record is taken, and the claim names its owner and moves the status.
SELECT is(
  public.claim_medical_record(
    '99999999-3333-0000-0000-000000000000'::uuid,
    'aaaaaaaa-3333-0000-0000-000000000000'::uuid,
    'structuring',
    900
  ),
  true,
  'an unclaimed record can be claimed'
);

SELECT is(
  (
    SELECT status::text || ':' || processing_run_id::text
    FROM public.medical_records
    WHERE id = '99999999-3333-0000-0000-000000000000'
  ),
  'structuring:aaaaaaaa-3333-0000-0000-000000000000',
  'the claim records its owner and the status it took'
);

-- This is the case a status predicate could not express: the second caller must lose.
SELECT is(
  public.claim_medical_record(
    '99999999-3333-0000-0000-000000000000'::uuid,
    'bbbbbbbb-3333-0000-0000-000000000000'::uuid,
    'structuring',
    900
  ),
  false,
  'a second run cannot take a record that is already claimed'
);

-- A worker that died leaves its claim behind; the lease is what frees the record.
UPDATE public.medical_records
SET processing_started_at = now() - interval '2 hours'
WHERE id = '99999999-3333-0000-0000-000000000000';

SELECT is(
  public.claim_medical_record(
    '99999999-3333-0000-0000-000000000000'::uuid,
    'bbbbbbbb-3333-0000-0000-000000000000'::uuid,
    'structuring',
    900
  ),
  true,
  'a claim older than its lease can be taken over'
);

SELECT is(
  public.claim_medical_record(
    '00000000-3333-0000-0000-000000000000'::uuid,
    'cccccccc-3333-0000-0000-000000000000'::uuid,
    'structuring',
    900
  ),
  false,
  'claiming a record that does not exist reports failure rather than raising'
);

SELECT * FROM finish();
ROLLBACK;
