-- Policies for money_mcc_canonical_category_map table

DROP POLICY IF EXISTS "money_mcc_canonical_category_map_select" ON public.money_mcc_canonical_category_map;
CREATE POLICY "money_mcc_canonical_category_map_select" ON public.money_mcc_canonical_category_map
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_mcc_canonical_category_map_insert" ON public.money_mcc_canonical_category_map;
CREATE POLICY "money_mcc_canonical_category_map_insert" ON public.money_mcc_canonical_category_map
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_mcc_canonical_category_map_update" ON public.money_mcc_canonical_category_map;
CREATE POLICY "money_mcc_canonical_category_map_update" ON public.money_mcc_canonical_category_map
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_mcc_canonical_category_map_delete" ON public.money_mcc_canonical_category_map;
CREATE POLICY "money_mcc_canonical_category_map_delete" ON public.money_mcc_canonical_category_map
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));

