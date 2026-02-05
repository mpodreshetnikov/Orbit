-- Policies for conditions table

DROP POLICY IF EXISTS "conditions_select" ON public.conditions;
CREATE POLICY "conditions_select" ON public.conditions
  FOR SELECT TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "conditions_insert" ON public.conditions;
CREATE POLICY "conditions_insert" ON public.conditions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "conditions_update" ON public.conditions;
CREATE POLICY "conditions_update" ON public.conditions
  FOR UPDATE TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "conditions_delete" ON public.conditions;
CREATE POLICY "conditions_delete" ON public.conditions
  FOR DELETE TO authenticated
  USING (public.is_allowed_user());
