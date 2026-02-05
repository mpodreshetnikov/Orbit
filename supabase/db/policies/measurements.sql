-- Policies for measurements table

DROP POLICY IF EXISTS "measurements_select" ON public.measurements;
CREATE POLICY "measurements_select" ON public.measurements
  FOR SELECT TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "measurements_insert" ON public.measurements;
CREATE POLICY "measurements_insert" ON public.measurements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "measurements_update" ON public.measurements;
CREATE POLICY "measurements_update" ON public.measurements
  FOR UPDATE TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "measurements_delete" ON public.measurements;
CREATE POLICY "measurements_delete" ON public.measurements
  FOR DELETE TO authenticated
  USING (public.is_allowed_user());
