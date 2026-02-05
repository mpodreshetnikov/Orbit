-- Policies for record_attachments table

DROP POLICY IF EXISTS "record_attachments_select" ON public.record_attachments;
CREATE POLICY "record_attachments_select" ON public.record_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "record_attachments_insert" ON public.record_attachments;
CREATE POLICY "record_attachments_insert" ON public.record_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "record_attachments_update" ON public.record_attachments;
CREATE POLICY "record_attachments_update" ON public.record_attachments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND public.is_allowed_user()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "record_attachments_delete" ON public.record_attachments;
CREATE POLICY "record_attachments_delete" ON public.record_attachments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND public.is_allowed_user()
  );
