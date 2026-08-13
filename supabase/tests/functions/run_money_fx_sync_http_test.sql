BEGIN;
SELECT plan(4);

SELECT has_function('public', 'run_money_fx_sync_http', ARRAY[]::text[]);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'money-fx-sync-daily'
  ),
  'money-fx-sync-daily cron job is scheduled'
);

-- money-fx-sync runs with verify_jwt = false and checks the bearer token itself, so the cron entry
-- point must send one. Without this the endpoint is reachable by anyone who knows the project URL.
SELECT ok(
  (
    SELECT prosrc LIKE '%money_fx_sync_token%'
    FROM pg_proc
    WHERE oid = 'public.run_money_fx_sync_http()'::regprocedure
  ),
  'run_money_fx_sync_http reads the money_fx_sync_token vault secret'
);

SELECT ok(
  (
    SELECT prosrc LIKE '%Authorization%'
    FROM pg_proc
    WHERE oid = 'public.run_money_fx_sync_http()'::regprocedure
  ),
  'run_money_fx_sync_http sends an Authorization header'
);

SELECT * FROM finish();
ROLLBACK;
