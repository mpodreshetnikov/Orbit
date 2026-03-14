-- Function: run_money_fx_sync_http()
-- Call money-fx-sync Edge Function via pg_net

CREATE OR REPLACE FUNCTION public.run_money_fx_sync_http()
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

  PERFORM net.http_post(
    url := TRIM(v_url) || '/functions/v1/money-fx-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
END;
$$;

COMMENT ON FUNCTION public.run_money_fx_sync_http() IS
  'Call money-fx-sync Edge Function via pg_net. URL from vault (project_url). No-op if not set.';
