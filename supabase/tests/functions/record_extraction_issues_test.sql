BEGIN;
SELECT plan(11);

SELECT has_table(
  'public',
  'record_extraction_issues',
  'the corrections the extraction made have somewhere to live'
);
SELECT col_not_null('public', 'record_extraction_issues', 'record_id', 'an issue belongs to a record');
SELECT col_is_null(
  'public',
  'record_extraction_issues',
  'field',
  'field is null when the whole entity was dropped rather than one value corrected'
);
SELECT has_column(
  'public',
  'record_extraction_issues',
  'entity_label',
  'a correction names the row it was made on, not only its kind'
);

-- The pipeline writes with the service role, which bypasses RLS. Granting insert or delete to
-- authenticated clients would let any allowlisted user fabricate or erase the record of what the
-- extraction corrected, without touching the values those warnings describe.
SELECT is(
  (
    SELECT count(*)::int
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'record_extraction_issues'
      AND cmd <> 'SELECT'
  ),
  0,
  'the browser cannot write these rows, only read them'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'record_extraction_issues'
      AND cmd = 'SELECT'
  ),
  1,
  'and it can read them'
);

SELECT has_index(
  'public',
  'record_extraction_issues',
  'idx_record_extraction_issues_record',
  'the review screen reads these by record'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES (
  '77777777-5555-0000-0000-000000000000',
  'issues-user@example.com',
  'authenticated',
  'authenticated'
);

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('77777777-5555-0000-0000-000000000000', 'issues-user@example.com');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '88888888-5555-0000-0000-000000000000',
  'Issues Person',
  'human',
  '77777777-5555-0000-0000-000000000000'
);

INSERT INTO public.medical_records (
  id, person_id, created_by_user_id, record_type, record_date, title, status
)
VALUES (
  '99999999-5555-0000-0000-000000000000',
  '88888888-5555-0000-0000-000000000000',
  '77777777-5555-0000-0000-000000000000',
  'lab', '2026-02-01'::date, 'Panel', 'structure_review'
);

-- The case the milestone exists for: the model wrote a status outside the vocabulary, the
-- column's default was used, and the other observations in the document were still saved.
INSERT INTO public.record_extraction_issues (
  record_id, entity_kind, entity_label, field, received, resolution, applied_fallback
)
VALUES (
  '99999999-5555-0000-0000-000000000000',
  'observation',
  'Гемоглобин',
  'observation.status',
  'borderline',
  'replaced_with_default',
  'unknown'
);

SELECT is(
  (
    SELECT entity_label || '/' || field || ':' || received || '->' || applied_fallback
    FROM public.record_extraction_issues
    WHERE record_id = '99999999-5555-0000-0000-000000000000'
  ),
  'Гемоглобин/observation.status:borderline->unknown',
  'the correction names the row, the field, what the document said, and what was saved instead'
);

-- A dropped entity has no field and no fallback, only a reason.
INSERT INTO public.record_extraction_issues (record_id, entity_kind, resolution, detail)
VALUES (
  '99999999-5555-0000-0000-000000000000',
  'observation',
  'dropped',
  'missing analyte label'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.record_extraction_issues
    WHERE record_id = '99999999-5555-0000-0000-000000000000'
  ),
  2,
  'both kinds of correction are recorded against the record'
);

-- Only the two resolutions exist: anything else would leave a reader guessing whether the value
-- survived.
SELECT throws_ok(
  $$
    INSERT INTO public.record_extraction_issues (record_id, entity_kind, resolution)
    VALUES ('99999999-5555-0000-0000-000000000000', 'finding', 'maybe')
  $$,
  '23514',
  NULL,
  'resolution rejects a value outside replaced_with_default/dropped'
);

-- The corrections describe one version of the record; deleting it takes them with it.
DELETE FROM public.medical_records WHERE id = '99999999-5555-0000-0000-000000000000';

SELECT is(
  (SELECT count(*)::int FROM public.record_extraction_issues),
  0,
  'issues do not outlive the record they describe'
);

SELECT * FROM finish();
ROLLBACK;
