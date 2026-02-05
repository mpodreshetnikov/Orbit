-- Policies for medical_records table

DROP POLICY IF EXISTS "medical_records_select" ON public.medical_records;
CREATE POLICY "medical_records_select" ON public.medical_records
  FOR SELECT TO authenticated
  USING (public.is_allowed_user());

DROP POLICY IF EXISTS "medical_records_insert" ON public.medical_records;
CREATE POLICY "medical_records_insert" ON public.medical_records
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_allowed_user()
    AND created_by_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "medical_records_update" ON public.medical_records;
CREATE POLICY "medical_records_update" ON public.medical_records
  FOR UPDATE TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "medical_records_delete" ON public.medical_records;
CREATE POLICY "medical_records_delete" ON public.medical_records
  FOR DELETE TO authenticated
  USING (public.is_allowed_user());
