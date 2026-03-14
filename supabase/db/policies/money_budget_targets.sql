-- Policies for money_budget_targets table

DROP POLICY IF EXISTS "money_budget_targets_select" ON public.money_budget_targets;
CREATE POLICY "money_budget_targets_select" ON public.money_budget_targets
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_budget_targets_insert" ON public.money_budget_targets;
CREATE POLICY "money_budget_targets_insert" ON public.money_budget_targets
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_budget_targets_update" ON public.money_budget_targets;
CREATE POLICY "money_budget_targets_update" ON public.money_budget_targets
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_budget_targets_delete" ON public.money_budget_targets;
CREATE POLICY "money_budget_targets_delete" ON public.money_budget_targets
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
