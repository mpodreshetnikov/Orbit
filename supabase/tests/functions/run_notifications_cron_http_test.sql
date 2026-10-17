BEGIN;
SELECT plan(6);

SELECT has_function('public', 'run_notifications_cron_http', ARRAY[]::text[]);

-- What the every-minute tick queues is readable in pg_net's table without anything leaving the
-- machine, the same approach as run_money_fx_sync_http_test.sql.
CREATE TEMP TABLE notifications_queue_baseline AS
SELECT coalesce(max(id), 0) AS max_id FROM net.http_request_queue;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url') THEN
    PERFORM vault.create_secret('http://kong:8000', 'project_url');
  END IF;
END;
$$;

SELECT public.run_notifications_cron_http();

SELECT ok(
  (
    SELECT queued.url LIKE '%/functions/v1/notifications-cron'
    FROM net.http_request_queue AS queued, notifications_queue_baseline AS baseline
    WHERE queued.id > baseline.max_id
    ORDER BY queued.id DESC
    LIMIT 1
  ),
  'the queued request targets the notifications-cron function'
);

-- 1 s was shorter than the function's first run after a deploy, so pg_net cut runs that would
-- have succeeded and logged them as timeouts. 30 s leaves room for that start-up and stays under
-- the one-minute cadence, so one tick's request is done before the next is released.
SELECT is(
  (
    SELECT queued.timeout_milliseconds
    FROM net.http_request_queue AS queued, notifications_queue_baseline AS baseline
    WHERE queued.id > baseline.max_id
    ORDER BY queued.id DESC
    LIMIT 1
  ),
  30000,
  'the request gets 30 s: room for a cold start, under the one-minute cadence'
);

-- `public` is exposed over PostgREST: an executable SECURITY DEFINER wrapper here would let any
-- client queue notification runs. Only the owner, which the cron job runs as, keeps EXECUTE.
SELECT ok(
  NOT has_function_privilege('anon', 'public.run_notifications_cron_http()', 'EXECUTE'),
  'anon cannot execute the cron wrapper'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.run_notifications_cron_http()', 'EXECUTE'),
  'authenticated cannot execute the cron wrapper'
);

SELECT ok(
  has_function_privilege('postgres', 'public.run_notifications_cron_http()', 'EXECUTE'),
  'the owner, which is what the cron job runs as, still can'
);

SELECT * FROM finish();
ROLLBACK;
