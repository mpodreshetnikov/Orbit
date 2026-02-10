-- Policies for money_line_items table

DROP POLICY IF EXISTS "money_line_items_select" ON public.money_line_items;
CREATE POLICY "money_line_items_select" ON public.money_line_items
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_line_items_insert" ON public.money_line_items;
CREATE POLICY "money_line_items_insert" ON public.money_line_items
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_line_items_update" ON public.money_line_items;
CREATE POLICY "money_line_items_update" ON public.money_line_items
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_line_items_delete" ON public.money_line_items;
CREATE POLICY "money_line_items_delete" ON public.money_line_items
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
