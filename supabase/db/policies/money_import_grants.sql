-- Policies for money_import_grants table
--
-- The household model applies to reading and revoking: any allowed user may see the credentials
-- in use and revoke one, because a credential you cannot revoke without its issuer present is
-- worse than no credential.
--
-- Issuing is narrower. `created_by_auth_user_id` is what `resolveAuth` re-checks against
-- `allowed_users` on every use of a grant, so a caller who could name someone else there could
-- mint a grant that outlives its own removal by pointing at a person who stays. The insert binds
-- that column to the caller, and `enforce_money_import_grant_issuer` keeps it bound afterwards.

DROP POLICY IF EXISTS "money_import_grants_select" ON public.money_import_grants;
CREATE POLICY "money_import_grants_select" ON public.money_import_grants
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_grants_insert" ON public.money_import_grants;
CREATE POLICY "money_import_grants_insert" ON public.money_import_grants
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_allowed_user())
    AND created_by_auth_user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "money_import_grants_update" ON public.money_import_grants;
CREATE POLICY "money_import_grants_update" ON public.money_import_grants
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()))
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_grants_delete" ON public.money_import_grants;
CREATE POLICY "money_import_grants_delete" ON public.money_import_grants
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
