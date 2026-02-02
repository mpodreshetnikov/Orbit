-- ============================================================================
-- Notifications cron: pg_cron + pg_net to call notifications-cron Edge Function
-- ============================================================================
-- Schedule the "notifications" job every minute to POST to the notifications-cron
-- Edge Function via pg_net. URL is read from Vault (project_url) so it is
-- environment-dependent (no hardcoded production URL).
--
-- Prerequisites:
-- - Enable "Cron" (pg_cron) and "pg_net" in Supabase Dashboard → Extensions
--   (hosted) or ensure both extensions are enabled locally.
-- - Vault must be available.
-- - For hosted: after deploy, run once:
--     SELECT vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
-- - For local: seed.sql sets project_url to http://kong:8000 after db reset.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.run_notifications_cron_http()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
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

  PERFORM net.http_post(
    url := TRIM(v_url) || '/functions/v1/notifications-cron',
    headers := jsonb_build_object(),
    timeout_milliseconds := 1000
  );
END;
$$;

COMMENT ON FUNCTION public.run_notifications_cron_http IS
  'Call notifications-cron Edge Function via pg_net. URL from vault (project_url). No-op if not set.';

-- ----------------------------------------------------------------------------
-- pg_cron: schedule notifications job every minute
-- ----------------------------------------------------------------------------
-- Idempotent: remove existing job then schedule (avoids duplicate on re-run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications') THEN
    PERFORM cron.unschedule('notifications');
  END IF;
END
$$;

SELECT cron.schedule(
  'notifications',
  '* * * * *',
  $$SELECT public.run_notifications_cron_http()$$
);
