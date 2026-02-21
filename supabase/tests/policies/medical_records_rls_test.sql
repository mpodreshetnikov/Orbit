BEGIN;
SELECT plan(4);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'medical_records'
      AND policyname = 'medical_records_select'
  ),
  'medical_records_select policy exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'medical_records'
      AND policyname = 'medical_records_insert'
  ),
  'medical_records_insert policy exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'medical_records'
      AND policyname = 'medical_records_update'
  ),
  'medical_records_update policy exists'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'medical_records'
      AND policyname = 'medical_records_delete'
  ),
  'medical_records_delete policy exists'
);

SELECT * FROM finish();
ROLLBACK;
