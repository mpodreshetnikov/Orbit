BEGIN;
SELECT plan(4);

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

-- Authenticated but not on allowed_users must be refused (SECURITY DEFINER bypasses RLS).
INSERT INTO auth.users (id, email, aud, role)
VALUES (
  'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
  'dose-deny@example.com',
  'authenticated',
  'authenticated'
);

DELETE FROM public.allowed_users WHERE email = 'dose-deny@example.com';

SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', true);
SELECT set_config('request.jwt.claim.email', 'dose-deny@example.com', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.mark_dose_taken(gen_random_uuid())$$,
  'Not authenticated',
  'mark_dose_taken refuses non-allowlisted authenticated callers'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
