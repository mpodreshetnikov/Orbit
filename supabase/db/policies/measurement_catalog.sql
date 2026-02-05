-- Policies for measurement_catalog table

DROP POLICY IF EXISTS "measurement_catalog_select" ON public.measurement_catalog;
CREATE POLICY "measurement_catalog_select" ON public.measurement_catalog
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "measurement_catalog_insert" ON public.measurement_catalog;
CREATE POLICY "measurement_catalog_insert" ON public.measurement_catalog
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "measurement_catalog_update" ON public.measurement_catalog;
CREATE POLICY "measurement_catalog_update" ON public.measurement_catalog
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "measurement_catalog_delete" ON public.measurement_catalog;
CREATE POLICY "measurement_catalog_delete" ON public.measurement_catalog
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
