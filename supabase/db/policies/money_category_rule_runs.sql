-- Policies for money_category_rule_runs table

DROP POLICY IF EXISTS "money_category_rule_runs_select" ON public.money_category_rule_runs;
CREATE POLICY "money_category_rule_runs_select" ON public.money_category_rule_runs
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_category_rule_runs_insert" ON public.money_category_rule_runs;
CREATE POLICY "money_category_rule_runs_insert" ON public.money_category_rule_runs
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_category_rule_runs_update" ON public.money_category_rule_runs;
CREATE POLICY "money_category_rule_runs_update" ON public.money_category_rule_runs
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_category_rule_runs_delete" ON public.money_category_rule_runs;
CREATE POLICY "money_category_rule_runs_delete" ON public.money_category_rule_runs
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

