-- Policies for med_regimens table

DROP POLICY IF EXISTS "med_regimens_select" ON public.med_regimens;
CREATE POLICY "med_regimens_select" ON public.med_regimens
  FOR SELECT TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "med_regimens_insert" ON public.med_regimens;
CREATE POLICY "med_regimens_insert" ON public.med_regimens
  FOR INSERT TO authenticated
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "med_regimens_update" ON public.med_regimens;
CREATE POLICY "med_regimens_update" ON public.med_regimens
  FOR UPDATE TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "med_regimens_delete" ON public.med_regimens;
CREATE POLICY "med_regimens_delete" ON public.med_regimens
  FOR DELETE TO authenticated
  USING (public.is_allowed_user());
