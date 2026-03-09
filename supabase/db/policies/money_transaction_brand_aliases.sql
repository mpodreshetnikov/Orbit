-- Policies for money_transaction_brand_aliases table

DROP POLICY IF EXISTS "money_transaction_brand_aliases_select" ON public.money_transaction_brand_aliases;
CREATE POLICY "money_transaction_brand_aliases_select" ON public.money_transaction_brand_aliases
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_transaction_brand_aliases_insert" ON public.money_transaction_brand_aliases;
CREATE POLICY "money_transaction_brand_aliases_insert" ON public.money_transaction_brand_aliases
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_transaction_brand_aliases_update" ON public.money_transaction_brand_aliases;
CREATE POLICY "money_transaction_brand_aliases_update" ON public.money_transaction_brand_aliases
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_transaction_brand_aliases_delete" ON public.money_transaction_brand_aliases;
CREATE POLICY "money_transaction_brand_aliases_delete" ON public.money_transaction_brand_aliases
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
