-- Policies for money_accounts table

DROP POLICY IF EXISTS "money_accounts_select" ON public.money_accounts;
CREATE POLICY "money_accounts_select" ON public.money_accounts
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_accounts_insert" ON public.money_accounts;
CREATE POLICY "money_accounts_insert" ON public.money_accounts
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_accounts_update" ON public.money_accounts;
CREATE POLICY "money_accounts_update" ON public.money_accounts
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_accounts_delete" ON public.money_accounts;
CREATE POLICY "money_accounts_delete" ON public.money_accounts
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
