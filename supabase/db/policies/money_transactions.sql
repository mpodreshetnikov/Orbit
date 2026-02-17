-- Policies for money_transactions table

DROP POLICY IF EXISTS "money_transactions_select" ON public.money_transactions;
CREATE POLICY "money_transactions_select" ON public.money_transactions
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_transactions_insert" ON public.money_transactions;
CREATE POLICY "money_transactions_insert" ON public.money_transactions
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_transactions_update" ON public.money_transactions;
CREATE POLICY "money_transactions_update" ON public.money_transactions
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_transactions_delete" ON public.money_transactions;
CREATE POLICY "money_transactions_delete" ON public.money_transactions
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
