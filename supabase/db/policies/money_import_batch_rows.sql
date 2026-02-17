-- Policies for money_import_batch_rows table

DROP POLICY IF EXISTS "money_import_batch_rows_select" ON public.money_import_batch_rows;
CREATE POLICY "money_import_batch_rows_select" ON public.money_import_batch_rows
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_batch_rows_insert" ON public.money_import_batch_rows;
CREATE POLICY "money_import_batch_rows_insert" ON public.money_import_batch_rows
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_batch_rows_update" ON public.money_import_batch_rows;
CREATE POLICY "money_import_batch_rows_update" ON public.money_import_batch_rows
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_import_batch_rows_delete" ON public.money_import_batch_rows;
CREATE POLICY "money_import_batch_rows_delete" ON public.money_import_batch_rows
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
