BEGIN;
SELECT plan(6);

SELECT has_function('public', 'run_money_fx_sync_http', ARRAY[]::text[]);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'money-fx-sync-daily'
  ),
  'money-fx-sync-daily cron job is scheduled'
);

-- What the scheduled job is worth depends on what it sends. `handler_test.ts` proves the edge
-- function refuses a request with no Authorization header — the function checks the token by
-- hand, because verify_jwt is off for it — and from that side alone there is no way to tell
-- whether the daily tick presents the token or has been quietly earning a 401 since the check
-- was added. This is the other side: pg_net queues the request in a table, so what the database
-- would send is readable here without anything leaving the machine.
CREATE TEMP TABLE fx_queue_baseline AS
SELECT coalesce(max(id), 0) AS max_id FROM net.http_request_queue;

DO $$
BEGIN
  -- Local and CI get this from seed.sql; created here too so the test does not depend on the
  -- seed having run, and the URL below is asserted by suffix rather than in full.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url') THEN
    PERFORM vault.create_secret('http://kong:8000', 'project_url');
  END IF;
END;
$$;

-- Deliberately before the token exists. A tick with nothing to present must do nothing at all,
-- rather than fire a request that can only come back 401 — every day, forever.
SELECT public.run_money_fx_sync_http();

SELECT is(
  (
    SELECT count(*)
    FROM net.http_request_queue AS queued, fx_queue_baseline AS baseline
    WHERE queued.id > baseline.max_id
  ),
  0::bigint,
  'no request is queued while money_fx_sync_token is unset'
);

SELECT vault.create_secret('fx-sync-token-for-tests', 'money_fx_sync_token');

SELECT public.run_money_fx_sync_http();

SELECT is(
  (
    SELECT count(*)
    FROM net.http_request_queue AS queued, fx_queue_baseline AS baseline
    WHERE queued.id > baseline.max_id
  ),
  1::bigint,
  'one request is queued once the token is in the vault'
);

SELECT ok(
  (
    SELECT queued.url LIKE '%/functions/v1/money-fx-sync'
    FROM net.http_request_queue AS queued, fx_queue_baseline AS baseline
    WHERE queued.id > baseline.max_id
    ORDER BY queued.id DESC
    LIMIT 1
  ),
  'the queued request targets the money-fx-sync function'
);

SELECT is(
  (
    SELECT queued.headers ->> 'Authorization'
    FROM net.http_request_queue AS queued, fx_queue_baseline AS baseline
    WHERE queued.id > baseline.max_id
    ORDER BY queued.id DESC
    LIMIT 1
  ),
  'Bearer fx-sync-token-for-tests',
  'the configured token is presented as a bearer credential'
);

SELECT * FROM finish();
ROLLBACK;
