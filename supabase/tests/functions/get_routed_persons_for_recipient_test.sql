BEGIN;
SELECT plan(3);

SELECT has_function(
  'public',
  'get_routed_persons_for_recipient',
  ARRAY['uuid']
);

SELECT is(
  (SELECT count(*) FROM public.get_routed_persons_for_recipient(gen_random_uuid())),
  0::bigint,
  'returns empty set for unknown recipient'
);

SELECT ok(
  (
    SELECT NOT p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_routed_persons_for_recipient'
      AND p.oid = 'public.get_routed_persons_for_recipient(uuid)'::regprocedure
  ),
  'function remains SECURITY INVOKER'
);

SELECT * FROM finish();
ROLLBACK;
