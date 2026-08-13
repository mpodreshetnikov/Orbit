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
  v_headers jsonb;
BEGIN
  SELECT decrypted_secret
  INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  LIMIT 1;

  IF v_url IS NULL OR TRIM(v_url) = '' THEN
    RETURN;
  END IF;

  -- money-fx-sync runs with verify_jwt = false and validates this bearer token itself. Without it
  -- the endpoint would accept a request from anyone who knows the project URL, and the request body
  -- chooses the collection window. The function fails closed, so a missing secret means the daily
  -- job stops rather than calling an unauthenticated endpoint.
  SELECT decrypted_secret
  INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'money_fx_sync_token'
  LIMIT 1;

  IF v_token IS NULL OR TRIM(v_token) = '' THEN
    RAISE WARNING 'run_money_fx_sync_http skipped: vault secret money_fx_sync_token is not set';
    RETURN;
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || TRIM(v_token)
  );

  PERFORM net.http_post(
    url := TRIM(v_url) || '/functions/v1/money-fx-sync',
    headers := v_headers,
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
END;
$$;

COMMENT ON FUNCTION public.run_money_fx_sync_http() IS
  'Call money-fx-sync Edge Function via pg_net with the money_fx_sync_token bearer. URL and token from vault. No-op if either is not set.';
