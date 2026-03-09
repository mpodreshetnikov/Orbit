-- Policies for money_transaction_brands table

DROP POLICY IF EXISTS "money_transaction_brands_select" ON public.money_transaction_brands;
CREATE POLICY "money_transaction_brands_select" ON public.money_transaction_brands
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_transaction_brands_insert" ON public.money_transaction_brands;
CREATE POLICY "money_transaction_brands_insert" ON public.money_transaction_brands
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_transaction_brands_update" ON public.money_transaction_brands;
CREATE POLICY "money_transaction_brands_update" ON public.money_transaction_brands
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_transaction_brands_delete" ON public.money_transaction_brands;
CREATE POLICY "money_transaction_brands_delete" ON public.money_transaction_brands
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
