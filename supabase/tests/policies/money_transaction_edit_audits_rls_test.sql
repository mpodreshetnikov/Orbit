BEGIN;
SELECT plan(4);

INSERT INTO auth.users (id, email, aud, role)
VALUES ('74000000-0000-0000-0000-000000000001', 'money-audit-rls@example.com', 'authenticated', 'authenticated');

INSERT INTO public.allowed_users (auth_user_id, email)
VALUES ('74000000-0000-0000-0000-000000000001', 'money-audit-rls@example.com');

INSERT INTO public.persons (id, name, kind)
VALUES ('74000000-0000-0000-0000-000000000010', 'Money Audit Person', 'human');

INSERT INTO public.money_accounts (
  id,
  owner_person_id,
  source,
  account_kind,
  account_label,
  currency
)
VALUES (
  '74000000-0000-0000-0000-000000000101',
  '74000000-0000-0000-0000-000000000010',
  'manual',
  'debit',
  'Audit account',
  'RUB'
);

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
  merchant_name,
  dedupe_hash
)
VALUES (
  '74000000-0000-0000-0000-000000000201',
  '74000000-0000-0000-0000-000000000010',
  '74000000-0000-0000-0000-000000000101',
  'manual',
  now(),
  -50,
  'RUB',
  'expense',
  'posted',
  'Audit merchant',
  'audit-hash-1'
);

INSERT INTO public.money_transaction_edit_audits (
  transaction_id,
  entity_kind,
  entity_id,
  before_snapshot,
  after_snapshot,
  edited_by_auth_user_id
)
VALUES (
  '74000000-0000-0000-0000-000000000201',
  'transaction',
  '74000000-0000-0000-0000-000000000201',
  '{"comment":"before"}'::jsonb,
  '{"comment":"after"}'::jsonb,
  '74000000-0000-0000-0000-000000000001'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transaction_edit_audits'
      AND policyname = 'money_transaction_edit_audits_select'
  ),
  'money_transaction_edit_audits_select policy exists'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.email', 'money-audit-rls@example.com', true);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_transaction_edit_audits
    WHERE transaction_id = '74000000-0000-0000-0000-000000000201'
  ),
  1::bigint,
  'allowlisted user can read money_transaction_edit_audits rows'
);

SELECT set_config('request.jwt.claim.email', 'money-audit-rls-deny@example.com', true);

SELECT is(
  (
    SELECT count(*)
    FROM public.money_transaction_edit_audits
    WHERE transaction_id = '74000000-0000-0000-0000-000000000201'
  ),
  0::bigint,
  'non-allowlisted user cannot read money_transaction_edit_audits rows'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transaction_edit_audits'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  ),
  'money_transaction_edit_audits has no authenticated write policies'
);

SELECT * FROM finish();
ROLLBACK;
