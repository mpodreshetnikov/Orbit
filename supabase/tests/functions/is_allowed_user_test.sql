BEGIN;
SELECT plan(4);

SELECT has_function('public', 'is_allowed_user', ARRAY[]::text[]);
SELECT function_returns('public', 'is_allowed_user', ARRAY[]::text[], 'boolean');

SELECT set_config('request.jwt.claim.email', 'pgtap-allow@example.com', true);
DELETE FROM public.allowed_users
WHERE email IN ('pgtap-allow@example.com', 'pgtap-deny@example.com');
INSERT INTO public.allowed_users (email) VALUES ('pgtap-allow@example.com');
SELECT ok(public.is_allowed_user(), 'is_allowed_user is true for allowlisted email claim');

SELECT set_config('request.jwt.claim.email', 'pgtap-deny@example.com', true);
SELECT ok(NOT public.is_allowed_user(), 'is_allowed_user is false for non-allowlisted email claim');

SELECT * FROM finish();
ROLLBACK;
