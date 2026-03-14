BEGIN;
SELECT plan(2);

SELECT has_function('public', 'run_money_fx_sync_http', ARRAY[]::text[]);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'money-fx-sync-daily'
  ),
  'money-fx-sync-daily cron job is scheduled'
);

SELECT * FROM finish();
ROLLBACK;
