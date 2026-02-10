-- Policies for money_import_batches table

DROP POLICY IF EXISTS "money_import_batches_select" ON public.money_import_batches;
CREATE POLICY "money_import_batches_select" ON public.money_import_batches
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_batches_insert" ON public.money_import_batches;
CREATE POLICY "money_import_batches_insert" ON public.money_import_batches
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_batches_update" ON public.money_import_batches;
CREATE POLICY "money_import_batches_update" ON public.money_import_batches
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_batches_delete" ON public.money_import_batches;
CREATE POLICY "money_import_batches_delete" ON public.money_import_batches
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
