-- Policies for condition_records table

DROP POLICY IF EXISTS "condition_records_select" ON public.condition_records;
CREATE POLICY "condition_records_select" ON public.condition_records
  FOR SELECT TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "condition_records_insert" ON public.condition_records;
CREATE POLICY "condition_records_insert" ON public.condition_records
  FOR INSERT TO authenticated
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "condition_records_update" ON public.condition_records;
CREATE POLICY "condition_records_update" ON public.condition_records
  FOR UPDATE TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "condition_records_delete" ON public.condition_records;
CREATE POLICY "condition_records_delete" ON public.condition_records
  FOR DELETE TO authenticated
  USING (public.is_allowed_user());
