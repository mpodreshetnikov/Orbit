-- Policies for observation_catalog table

DROP POLICY IF EXISTS "observation_catalog_select" ON public.observation_catalog;
CREATE POLICY "observation_catalog_select" ON public.observation_catalog
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "observation_catalog_insert" ON public.observation_catalog;
CREATE POLICY "observation_catalog_insert" ON public.observation_catalog
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "observation_catalog_update" ON public.observation_catalog;
CREATE POLICY "observation_catalog_update" ON public.observation_catalog
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "observation_catalog_delete" ON public.observation_catalog;
CREATE POLICY "observation_catalog_delete" ON public.observation_catalog
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
