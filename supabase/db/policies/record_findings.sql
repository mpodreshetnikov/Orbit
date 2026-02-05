-- Policies for record_findings table

DROP POLICY IF EXISTS "record_findings_select" ON public.record_findings;
CREATE POLICY "record_findings_select" ON public.record_findings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_findings_insert" ON public.record_findings;
CREATE POLICY "record_findings_insert" ON public.record_findings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_findings_update" ON public.record_findings;
CREATE POLICY "record_findings_update" ON public.record_findings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_findings_delete" ON public.record_findings;
CREATE POLICY "record_findings_delete" ON public.record_findings
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );
