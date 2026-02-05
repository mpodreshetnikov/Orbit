-- Policies for finding_type_catalog table

DROP POLICY IF EXISTS "finding_type_catalog_select" ON public.finding_type_catalog;
CREATE POLICY "finding_type_catalog_select" ON public.finding_type_catalog
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "finding_type_catalog_insert" ON public.finding_type_catalog;
CREATE POLICY "finding_type_catalog_insert" ON public.finding_type_catalog
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "finding_type_catalog_update" ON public.finding_type_catalog;
CREATE POLICY "finding_type_catalog_update" ON public.finding_type_catalog
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "finding_type_catalog_delete" ON public.finding_type_catalog;
CREATE POLICY "finding_type_catalog_delete" ON public.finding_type_catalog
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
