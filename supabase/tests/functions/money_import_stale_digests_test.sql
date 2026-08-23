BEGIN;
SELECT plan(6);

SELECT has_function('public', 'create_money_import_stale_digests', ARRAY['integer']);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('7e000000-0000-0000-0000-000000000001', 'money-stale@example.com', 'authenticated', 'authenticated');

INSERT INTO public.persons (id, name, kind, auth_user_id)
VALUES ('7e000000-0000-0000-0000-000000000010', 'Money Stale Person', 'human', '7e000000-0000-0000-0000-000000000001');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency,
  is_active
)
VALUES (
  '7e000000-0000-0000-0000-000000000020',
  '7e000000-0000-0000-0000-000000000010',
  'tbank',
  'debit',
  'Stale digest account',
  'RUB',
  true
);

INSERT INTO public.money_import_batches (
  id,
  source,
  payer_person_id,
  import_type,
  status,
  completed_at
)
VALUES (
  '7e000000-0000-0000-0000-000000000030',
  'tbank',
  '7e000000-0000-0000-0000-000000000010',
  'web_export',
  'completed',
  now() - interval '1 day'
);

-- The function is a sweep over everyone with an active account, so its return value counts
-- other people's reminders too — the seed alone supplies a couple. Every assertion below
-- therefore looks at this person's digests rather than at the number the sweep returns.
CREATE TEMP TABLE _sweep_recent AS SELECT public.create_money_import_stale_digests(5) AS created;

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE type = 'money_import_stale'
      AND person_id = '7e000000-0000-0000-0000-000000000010'
      AND payload_json->>'source' = 'tbank'
  ),
  0::bigint,
  'a recent completed import raises no reminder'
);

UPDATE public.money_import_batches
SET completed_at = now() - interval '10 days'
WHERE id = '7e000000-0000-0000-0000-000000000030';

CREATE TEMP TABLE _sweep_stale AS SELECT public.create_money_import_stale_digests(5) AS created;

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE type = 'money_import_stale'
      AND person_id = '7e000000-0000-0000-0000-000000000010'
      AND payload_json->>'source' = 'tbank'
  ),
  1::bigint,
  'an import that has not completed in days raises exactly one reminder'
);

-- Repeating the reminder every run would teach the owner to ignore it.
CREATE TEMP TABLE _sweep_repeat AS SELECT public.create_money_import_stale_digests(5) AS created;

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE type = 'money_import_stale'
      AND person_id = '7e000000-0000-0000-0000-000000000010'
      AND payload_json->>'source' = 'tbank'
  ),
  1::bigint,
  'a second run inside the same window does not repeat the reminder'
);

SELECT is(
  (
    SELECT payload_json->>'source'
    FROM public.notification_digests
    WHERE type = 'money_import_stale'
      AND person_id = '7e000000-0000-0000-0000-000000000010'
  ),
  'tbank',
  'the reminder names the source that went stale'
);

-- The staleness signal must be the import run, not the spending. A month with no purchases
-- is not a broken import, and must not look like one.
DELETE FROM public.notification_digests
WHERE type = 'money_import_stale'
  AND person_id = '7e000000-0000-0000-0000-000000000010';

UPDATE public.money_import_batches
SET completed_at = now() - interval '1 hour'
WHERE id = '7e000000-0000-0000-0000-000000000030';

INSERT INTO public.money_transactions (
  id,
  payer_person_id,
  account_id,
  source,
  posted_at,
  amount,
  currency,
  transaction_type,
  status,
  dedupe_hash
)
VALUES (
  '7e000000-0000-0000-0000-000000000040',
  '7e000000-0000-0000-0000-000000000010',
  '7e000000-0000-0000-0000-000000000020',
  'tbank',
  now() - interval '60 days',
  -100,
  'RUB',
  'expense',
  'posted',
  'stale-digest-hash-1'
);

CREATE TEMP TABLE _sweep_quiet AS SELECT public.create_money_import_stale_digests(5) AS created;

SELECT is(
  (
    SELECT count(*)
    FROM public.notification_digests
    WHERE type = 'money_import_stale'
      AND person_id = '7e000000-0000-0000-0000-000000000010'
      AND payload_json->>'source' = 'tbank'
  ),
  0::bigint,
  'a long stretch without spending is not mistaken for a broken import'
);

SELECT * FROM finish();
ROLLBACK;
