-- Policies for money_import_batch_brand_resolutions table

DROP POLICY IF EXISTS "money_import_batch_brand_resolutions_select" ON public.money_import_batch_brand_resolutions;
CREATE POLICY "money_import_batch_brand_resolutions_select" ON public.money_import_batch_brand_resolutions
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_batch_brand_resolutions_insert" ON public.money_import_batch_brand_resolutions;
CREATE POLICY "money_import_batch_brand_resolutions_insert" ON public.money_import_batch_brand_resolutions
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_batch_brand_resolutions_update" ON public.money_import_batch_brand_resolutions;
CREATE POLICY "money_import_batch_brand_resolutions_update" ON public.money_import_batch_brand_resolutions
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_batch_brand_resolutions_delete" ON public.money_import_batch_brand_resolutions;
CREATE POLICY "money_import_batch_brand_resolutions_delete" ON public.money_import_batch_brand_resolutions
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
