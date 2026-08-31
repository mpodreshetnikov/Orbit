BEGIN;
SELECT plan(6);

-- The column that replaced the size_mm/count zero sentinel on record_findings.
SELECT has_column(
  'public',
  'record_findings',
  'resolution_status',
  'record_findings has resolution_status'
);
SELECT col_not_null(
  'public',
  'record_findings',
  'resolution_status',
  'resolution_status is never null'
);
SELECT col_default_is(
  'public',
  'record_findings',
  'resolution_status',
  'observed',
  'a finding is observed unless it says otherwise'
);
SELECT has_index(
  'public',
  'record_findings',
  'idx_record_findings_resolution_status',
  'resolution_status is indexed for the active-findings read'
);

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('77777777-1111-0000-0000-000000000000', 'resolution-user@example.com');

SELECT set_config('request.jwt.claim.sub', '77777777-1111-0000-0000-000000000000', true);
SELECT set_config('request.jwt.claim.email', 'resolution-user@example.com', true);

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '88888888-1111-0000-0000-000000000000',
  'Resolution Person',
  'human',
  '77777777-1111-0000-0000-000000000000'
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
  '99999999-1111-0000-0000-000000000000',
  '88888888-1111-0000-0000-000000000000',
  '77777777-1111-0000-0000-000000000000',
  'imaging',
  '2026-02-01'::date,
  'Ultrasound',
  'active'
);

-- A measurement that really is zero stays an observed finding. Under the sentinel this row
-- disappeared from the active list, which is the defect the column removes.
INSERT INTO public.record_findings (
  person_id,
  record_id,
  finding_type_text,
  size_mm,
  count,
  source_anchor
)
VALUES (
  '88888888-1111-0000-0000-000000000000',
  '99999999-1111-0000-0000-000000000000',
  'Nodule',
  0,
  0,
  'measured zero'
);

SELECT is(
  (
    SELECT resolution_status
    FROM public.record_findings
    WHERE source_anchor = 'measured zero'
  ),
  'observed',
  'a zero size and count is still an observed finding'
);

-- Only the two states exist: anything else reintroduces the ambiguity the column removes.
SELECT throws_ok(
  $$
    INSERT INTO public.record_findings (
      person_id, record_id, finding_type_text, source_anchor, resolution_status
    )
    VALUES (
      '88888888-1111-0000-0000-000000000000',
      '99999999-1111-0000-0000-000000000000',
      'Nodule',
      'bad status',
      'maybe'
    )
  $$,
  '23514',
  NULL,
  'resolution_status rejects a value outside observed/resolved'
);

SELECT * FROM finish();
ROLLBACK;
