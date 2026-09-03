BEGIN;
SELECT plan(13);

-- Provenance on the condition itself. Existing rows must read as "not LLM, already reviewed", so
-- that a later cleanup of unverified LLM rows can never sweep up data that predates this path.
SELECT has_column('public', 'conditions', 'is_llm_extracted', 'conditions records its provenance');
SELECT has_column('public', 'conditions', 'is_user_verified', 'conditions records its approval');
SELECT col_default_is(
  'public',
  'conditions',
  'is_llm_extracted',
  false,
  'a condition is not assumed to be LLM-created'
);
SELECT col_default_is(
  'public',
  'conditions',
  'is_user_verified',
  true,
  'a condition is not assumed to be unreviewed'
);

SELECT col_is_null(
  'public',
  'condition_records',
  'condition_id',
  'a mention can exist before the condition does'
);

INSERT INTO auth.users (id, email, aud, role)
VALUES (
  '77777777-2222-0000-0000-000000000000',
  'proposal-user@example.com',
  'authenticated',
  'authenticated'
);

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('77777777-2222-0000-0000-000000000000', 'proposal-user@example.com');

SELECT set_config('request.jwt.claim.sub', '77777777-2222-0000-0000-000000000000', true);
SELECT set_config('request.jwt.claim.email', 'proposal-user@example.com', true);

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES (
  '88888888-2222-0000-0000-000000000000',
  'Proposal Person',
  'human',
  '77777777-2222-0000-0000-000000000000'
);

INSERT INTO public.medical_records (
  id, person_id, created_by_user_id, record_type, record_date, title, status
)
VALUES (
  '99999999-2222-0000-0000-000000000000',
  '88888888-2222-0000-0000-000000000000',
  '77777777-2222-0000-0000-000000000000',
  'visit',
  '2026-02-01'::date,
  'Consultation',
  'structure_review'
);

-- A proposal: no condition behind it, a name from the document.
INSERT INTO public.condition_records (
  record_id, status_in_record, proposed_name, proposed_icd_code, source_anchor, confidence
)
VALUES (
  '99999999-2222-0000-0000-000000000000',
  'suspected',
  'Asthma',
  'J45',
  'asthma noted',
  0.8
);

-- A mention with neither a condition nor a name is meaningless and must be refused.
SELECT throws_ok(
  $$
    INSERT INTO public.condition_records (record_id, status_in_record, source_anchor)
    VALUES ('99999999-2222-0000-0000-000000000000', 'active', 'nothing named')
  $$,
  '23514',
  NULL,
  'a mention must either link to a condition or name one'
);

-- Re-running extraction on the same record must not stack duplicates of the same proposal.
SELECT throws_ok(
  $$
    INSERT INTO public.condition_records (record_id, status_in_record, proposed_name)
    VALUES ('99999999-2222-0000-0000-000000000000', 'suspected', '  asthma ')
  $$,
  '23505',
  NULL,
  'one proposal per name per record'
);

SELECT is(
  (
    SELECT is_proposal
    FROM public.get_record_conditions('99999999-2222-0000-0000-000000000000'::uuid)
    WHERE condition_name = 'Asthma'
  ),
  true,
  'the reader reports a mention with no condition as a proposal'
);

SELECT is(
  (
    SELECT condition_code
    FROM public.get_record_conditions('99999999-2222-0000-0000-000000000000'::uuid)
    WHERE condition_name = 'Asthma'
  ),
  'J45',
  'a proposal shows the code the document gave it'
);

-- What a proposed closure rests on, and whether anyone ruled on it. Both have to survive the
-- reader, or the review screen can neither name the measurement nor tell a rejection from a
-- proposal nobody has opened.
SELECT has_column(
  'public',
  'condition_records',
  'supporting_obs_code',
  'a mention records the analyte a proposed closure rests on'
);
SELECT col_default_is(
  'public',
  'condition_records',
  'review_decision',
  'pending',
  'a mention nobody has ruled on reads as pending'
);

-- The three states must stay three: a fourth would let a closure be recorded as reviewed in a way
-- the promotion counts do not understand.
SELECT throws_ok(
  $$INSERT INTO public.condition_records (record_id, status_in_record, proposed_name, review_decision)
    VALUES (
      '99999999-2222-0000-0000-000000000000'::uuid,
      'resolved',
      'Bronchitis',
      'maybe'
    )$$,
  '23514',
  NULL,
  'review_decision accepts only pending, confirmed and dismissed'
);

SELECT is(
  (
    SELECT review_decision
    FROM public.get_record_conditions('99999999-2222-0000-0000-000000000000'::uuid)
    WHERE condition_name = 'Asthma'
  ),
  'pending',
  'the reader reports the review decision it stored'
);

SELECT * FROM finish();
ROLLBACK;
