-- Policies for body_site_catalog table

DROP POLICY IF EXISTS "body_site_catalog_select" ON public.body_site_catalog;
CREATE POLICY "body_site_catalog_select" ON public.body_site_catalog
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "body_site_catalog_insert" ON public.body_site_catalog;
CREATE POLICY "body_site_catalog_insert" ON public.body_site_catalog
  FOR INSERT TO authenticated
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "body_site_catalog_update" ON public.body_site_catalog;
CREATE POLICY "body_site_catalog_update" ON public.body_site_catalog
  FOR UPDATE TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "body_site_catalog_delete" ON public.body_site_catalog;
CREATE POLICY "body_site_catalog_delete" ON public.body_site_catalog
  FOR DELETE TO authenticated
  USING (public.is_allowed_user());
