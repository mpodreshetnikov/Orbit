-- A grant's authority is fixed at issue time. The only thing an update may change is whether it
-- is revoked.
--
-- Revoking is deliberately open to the whole household: a credential you cannot revoke without
-- its issuer present is worse than no credential. That openness is also the attack surface. With
-- an unrestricted UPDATE, an allowlisted user could take another still-allowed user's grant and
-- replace `token_hash` with the hash of a token they hold, or repoint `person_id` and
-- `allowed_sources`. `resolveAuth` re-checks the issuer, which has not changed and is still
-- allowed, so the hijacked token would survive the attacker's own removal from `allowed_users` --
-- exactly the outcome that recheck exists to prevent.
--
-- So the row's authority -- who issued it, whose money it may touch, which sources it may import,
-- and the secret it answers to -- is frozen, and revoked_at is one-way. Everything an import
-- legitimately writes afterwards (`last_used_at`, `updated_at`) stays open.

CREATE OR REPLACE FUNCTION public.enforce_money_import_grant_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.created_by_auth_user_id IS DISTINCT FROM OLD.created_by_auth_user_id THEN
    RAISE EXCEPTION 'created_by_auth_user_id is fixed at issue time and cannot be changed';
  END IF;

  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN
    RAISE EXCEPTION 'token_hash is fixed at issue time; issue a new grant instead';
  END IF;

  IF NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    RAISE EXCEPTION 'person_id is fixed at issue time; issue a new grant instead';
  END IF;

  IF NEW.allowed_sources IS DISTINCT FROM OLD.allowed_sources THEN
    RAISE EXCEPTION 'allowed_sources is fixed at issue time; issue a new grant instead';
  END IF;

  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'expires_at is fixed at issue time; issue a new grant instead';
  END IF;

  -- Revocation is one-way, and final in its exact value. Clearing it to NULL would resurrect a
  -- credential treated as dead; rewriting it to another timestamp is the same act wearing a
  -- disguise, because `timestamptz` accepts `infinity`, which is not NULL and which every reader
  -- that parses it as a date sees as no revocation at all.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'a revoked grant cannot have its revocation rewritten; issue a new grant instead';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_money_import_grant_issuer ON public.money_import_grants;
DROP TRIGGER IF EXISTS enforce_money_import_grant_authority ON public.money_import_grants;
CREATE TRIGGER enforce_money_import_grant_authority
  BEFORE UPDATE ON public.money_import_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_import_grant_authority();

DROP FUNCTION IF EXISTS public.enforce_money_import_grant_issuer();
