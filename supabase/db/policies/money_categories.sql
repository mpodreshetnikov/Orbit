-- Policies for money_categories table

DROP POLICY IF EXISTS "money_categories_select" ON public.money_categories;
CREATE POLICY "money_categories_select" ON public.money_categories
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_categories_insert" ON public.money_categories;
CREATE POLICY "money_categories_insert" ON public.money_categories
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_categories_update" ON public.money_categories;
CREATE POLICY "money_categories_update" ON public.money_categories
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_categories_delete" ON public.money_categories;
CREATE POLICY "money_categories_delete" ON public.money_categories
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
