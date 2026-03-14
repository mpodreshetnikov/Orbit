-- Policies for money_category_rule_run_steps table

DROP POLICY IF EXISTS "money_category_rule_run_steps_select" ON public.money_category_rule_run_steps;
CREATE POLICY "money_category_rule_run_steps_select" ON public.money_category_rule_run_steps
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_category_rule_run_steps_insert" ON public.money_category_rule_run_steps;
CREATE POLICY "money_category_rule_run_steps_insert" ON public.money_category_rule_run_steps
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_category_rule_run_steps_update" ON public.money_category_rule_run_steps;
CREATE POLICY "money_category_rule_run_steps_update" ON public.money_category_rule_run_steps
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_category_rule_run_steps_delete" ON public.money_category_rule_run_steps;
CREATE POLICY "money_category_rule_run_steps_delete" ON public.money_category_rule_run_steps
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

