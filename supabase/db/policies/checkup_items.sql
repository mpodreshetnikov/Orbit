-- Policies for checkup_items table

DROP POLICY IF EXISTS "checkup_items_select" ON public.checkup_items;
CREATE POLICY "checkup_items_select" ON public.checkup_items
  FOR SELECT TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "checkup_items_insert" ON public.checkup_items;
CREATE POLICY "checkup_items_insert" ON public.checkup_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "checkup_items_update" ON public.checkup_items;
CREATE POLICY "checkup_items_update" ON public.checkup_items
  FOR UPDATE TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "checkup_items_delete" ON public.checkup_items;
CREATE POLICY "checkup_items_delete" ON public.checkup_items
  FOR DELETE TO authenticated
  USING (public.is_allowed_user());
