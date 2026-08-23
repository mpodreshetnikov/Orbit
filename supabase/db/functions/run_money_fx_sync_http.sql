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
  v_token text;
BEGIN
  SELECT decrypted_secret
  INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  LIMIT 1;

  IF v_url IS NULL OR TRIM(v_url) = '' THEN
    RETURN;
  END IF;

  -- The Edge Function validates this token by hand because verify_jwt is off for it.
  -- Without the secret there is nothing to present, and firing the call anyway would
  -- only produce a 401 on every schedule tick.
  SELECT decrypted_secret
  INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'money_fx_sync_token'
  LIMIT 1;

  IF v_token IS NULL OR TRIM(v_token) = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := TRIM(v_url) || '/functions/v1/money-fx-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || TRIM(v_token)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
END;
$$;

COMMENT ON FUNCTION public.run_money_fx_sync_http() IS
  'Call money-fx-sync Edge Function via pg_net. URL and token from vault (project_url, money_fx_sync_token). No-op if either is unset.';
