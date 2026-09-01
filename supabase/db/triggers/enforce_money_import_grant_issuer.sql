-- A grant's issuer is fixed at issue time and never edited afterwards.
--
-- The insert policy binds `created_by_auth_user_id` to the caller, but an UPDATE could otherwise
-- move it: revoking is deliberately open to the whole household, and the same UPDATE that revokes
-- could repoint the issuer at someone who is still in `allowed_users`. That would restore exactly
-- the credential this column exists to expire.

CREATE OR REPLACE FUNCTION public.enforce_money_import_grant_issuer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.created_by_auth_user_id IS DISTINCT FROM OLD.created_by_auth_user_id THEN
    RAISE EXCEPTION 'created_by_auth_user_id is fixed at issue time and cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_money_import_grant_issuer ON public.money_import_grants;
CREATE TRIGGER enforce_money_import_grant_issuer
  BEFORE UPDATE ON public.money_import_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_import_grant_issuer();
