-- Function: run_notifications_cron_http()
-- Call notifications-cron Edge Function via pg_net

CREATE OR REPLACE FUNCTION public.run_notifications_cron_http()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $$
DECLARE
  v_url text;
BEGIN
  SELECT decrypted_secret
  INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  LIMIT 1;

  IF v_url IS NULL OR TRIM(v_url) = '' THEN
    RETURN;
  END IF;

  -- 1 s was shorter than the function's first run after a deploy, which builds its module graph,
  -- so pg_net cut the request and logged a timeout for a run that would have succeeded. It is a
  -- ceiling, not a wait: the cron job returns as soon as the request is queued.
  PERFORM net.http_post(
    url := TRIM(v_url) || '/functions/v1/notifications-cron',
    headers := jsonb_build_object(),
    timeout_milliseconds := 30000
  );
END;
$$;

COMMENT ON FUNCTION public.run_notifications_cron_http() IS
  'Call notifications-cron Edge Function via pg_net. URL from vault (project_url). No-op if not set.';
