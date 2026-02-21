BEGIN;
SELECT plan(1);

SELECT has_function('public', 'is_allowed_user', ARRAY[]::text[]);

SELECT * FROM finish();
ROLLBACK;
