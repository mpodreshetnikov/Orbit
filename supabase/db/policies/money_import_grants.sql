-- Policies for money_import_grants table

DROP POLICY IF EXISTS "money_import_grants_select" ON public.money_import_grants;
CREATE POLICY "money_import_grants_select" ON public.money_import_grants
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_grants_insert" ON public.money_import_grants;
CREATE POLICY "money_import_grants_insert" ON public.money_import_grants
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_grants_update" ON public.money_import_grants;
CREATE POLICY "money_import_grants_update" ON public.money_import_grants
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_grants_delete" ON public.money_import_grants;
CREATE POLICY "money_import_grants_delete" ON public.money_import_grants
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
