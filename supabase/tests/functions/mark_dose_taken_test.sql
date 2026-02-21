BEGIN;
SELECT plan(3);

SELECT has_function(
  'public',
  'mark_dose_taken',
  ARRAY['uuid', 'text', 'timestamp with time zone']
);

SELECT function_returns(
  'public',
  'mark_dose_taken',
  ARRAY['uuid', 'text', 'timestamp with time zone'],
  'void'
);

SELECT throws_ok(
  $$SELECT public.mark_dose_taken(gen_random_uuid())$$,
  'Not authenticated',
  'mark_dose_taken requires auth context'
);

SELECT * FROM finish();
ROLLBACK;
