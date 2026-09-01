-- Policies for record_extraction_issues table

DROP POLICY IF EXISTS "record_extraction_issues_select" ON public.record_extraction_issues;
CREATE POLICY "record_extraction_issues_select" ON public.record_extraction_issues
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_extraction_issues_insert" ON public.record_extraction_issues;
CREATE POLICY "record_extraction_issues_insert" ON public.record_extraction_issues
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "record_extraction_issues_delete" ON public.record_extraction_issues;
CREATE POLICY "record_extraction_issues_delete" ON public.record_extraction_issues
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND (select public.is_allowed_user())
  );
