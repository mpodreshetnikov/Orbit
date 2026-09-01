BEGIN;
SELECT plan(7);

SELECT has_function(
  'public',
  'release_abandoned_record_processing',
  ARRAY['integer'],
  'the reaper that replaced the browser timeout exists'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES (
  '77777777-4444-0000-0000-000000000000',
  'abandoned-user@example.com',
  'authenticated',
  'authenticated'
);

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('77777777-4444-0000-0000-000000000000', 'abandoned-user@example.com');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '88888888-4444-0000-0000-000000000000',
  'Abandoned Person',
  'human',
  '77777777-4444-0000-0000-000000000000'
);

INSERT INTO public.medical_records (
  id, person_id, created_by_user_id, record_type, record_date, title, status,
  processing_run_id, processing_started_at
)
VALUES
  -- A dead OCR worker: claimed two hours ago, never renewed.
  (
    '99999999-4444-0000-0000-000000000001',
    '88888888-4444-0000-0000-000000000000',
    '77777777-4444-0000-0000-000000000000',
    'lab', '2026-02-01'::date, 'Dead OCR run', 'ocr_processing',
    'aaaaaaaa-4444-0000-0000-000000000000', now() - interval '2 hours'
  ),
  -- A dead structuring worker: the same, one stage later.
  (
    '99999999-4444-0000-0000-000000000002',
    '88888888-4444-0000-0000-000000000000',
    '77777777-4444-0000-0000-000000000000',
    'lab', '2026-02-01'::date, 'Dead structuring run', 'structuring',
    'bbbbbbbb-4444-0000-0000-000000000000', now() - interval '2 hours'
  ),
  -- A live run that renewed a moment ago. Releasing this one would take a document away from
  -- the worker transcribing it, which is the failure mode this whole milestone removes.
  (
    '99999999-4444-0000-0000-000000000003',
    '88888888-4444-0000-0000-000000000000',
    '77777777-4444-0000-0000-000000000000',
    'lab', '2026-02-01'::date, 'Live run', 'ocr_processing',
    'cccccccc-4444-0000-0000-000000000000', now()
  );

-- A record the client moved to ocr_processing whose request never arrived: no claim was ever
-- taken, so only updated_at says how long it has been sitting there.
-- updated_at is set on the insert on purpose: the table's trigger rewrites it to now() on every
-- update, so an update could not age this row.
INSERT INTO public.medical_records (
  id, person_id, created_by_user_id, record_type, record_date, title, status, updated_at
)
VALUES (
  '99999999-4444-0000-0000-000000000004',
  '88888888-4444-0000-0000-000000000000',
  '77777777-4444-0000-0000-000000000000',
  'lab', '2026-02-01'::date, 'Never claimed', 'ocr_processing', now() - interval '2 hours'
);

SELECT is(
  public.release_abandoned_record_processing(900),
  3,
  'the three abandoned records are released and the live one is not'
);

SELECT is(
  (
    SELECT status::text || ':' || COALESCE(ocr_error, '')
    FROM public.medical_records
    WHERE id = '99999999-4444-0000-0000-000000000001'
  ),
  'ocr_failed:Processing stopped unexpectedly and was released. Retry to run it again.',
  'a dead OCR run leaves a record the user can retry, with a reason'
);

SELECT is(
  (
    SELECT status::text || ':' || COALESCE(structure_error, '')
    FROM public.medical_records
    WHERE id = '99999999-4444-0000-0000-000000000002'
  ),
  'ocr_review:Processing stopped unexpectedly and was released. Retry to run it again.',
  'a dead structuring run goes back to the review step it was started from'
);

SELECT is(
  (
    SELECT processing_run_id IS NULL AND processing_started_at IS NULL
    FROM public.medical_records
    WHERE id = '99999999-4444-0000-0000-000000000004'
  ),
  true,
  'a released record holds no claim, so the next run can take it'
);

SELECT is(
  (
    SELECT status::text || ':' || processing_run_id::text
    FROM public.medical_records
    WHERE id = '99999999-4444-0000-0000-000000000003'
  ),
  'ocr_processing:cccccccc-4444-0000-0000-000000000000',
  'a live run keeps its record and its claim'
);

SELECT is(
  public.release_abandoned_record_processing(900),
  0,
  'a second sweep finds nothing left to release'
);

SELECT * FROM finish();
ROLLBACK;
