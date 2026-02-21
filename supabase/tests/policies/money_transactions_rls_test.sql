BEGIN;
SELECT plan(4);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transactions'
      AND policyname = 'money_transactions_select'
  ),
  'money_transactions_select policy exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transactions'
      AND policyname = 'money_transactions_insert'
  ),
  'money_transactions_insert policy exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transactions'
      AND policyname = 'money_transactions_update'
  ),
  'money_transactions_update policy exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'money_transactions'
      AND policyname = 'money_transactions_delete'
  ),
  'money_transactions_delete policy exists'
);

SELECT * FROM finish();
ROLLBACK;
