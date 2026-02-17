-- Policies for money_import_sessions table

DROP POLICY IF EXISTS "money_import_sessions_select" ON public.money_import_sessions;
CREATE POLICY "money_import_sessions_select" ON public.money_import_sessions
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_sessions_insert" ON public.money_import_sessions;
CREATE POLICY "money_import_sessions_insert" ON public.money_import_sessions
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_sessions_update" ON public.money_import_sessions;
CREATE POLICY "money_import_sessions_update" ON public.money_import_sessions
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_sessions_delete" ON public.money_import_sessions;
CREATE POLICY "money_import_sessions_delete" ON public.money_import_sessions
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
