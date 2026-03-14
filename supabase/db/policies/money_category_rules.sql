-- Policies for money_category_rules table

DROP POLICY IF EXISTS "money_category_rules_select" ON public.money_category_rules;
CREATE POLICY "money_category_rules_select" ON public.money_category_rules
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_category_rules_insert" ON public.money_category_rules;
CREATE POLICY "money_category_rules_insert" ON public.money_category_rules
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_category_rules_update" ON public.money_category_rules;
CREATE POLICY "money_category_rules_update" ON public.money_category_rules
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_category_rules_delete" ON public.money_category_rules;
CREATE POLICY "money_category_rules_delete" ON public.money_category_rules
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

