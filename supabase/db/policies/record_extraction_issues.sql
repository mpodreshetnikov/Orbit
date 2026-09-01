-- Policies for record_extraction_issues table

-- The browser only ever reads these. Writing is the pipeline's business, done with the service
-- role, which bypasses RLS entirely -- so granting insert or delete to authenticated clients
-- would buy nothing and let any allowlisted user fabricate or erase the record of what the
-- extraction corrected, without touching the values those warnings are about.
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

-- Insert and delete are deliberately absent, and dropped here in case an earlier revision of this
-- migration created them.
DROP POLICY IF EXISTS "record_extraction_issues_insert" ON public.record_extraction_issues;
DROP POLICY IF EXISTS "record_extraction_issues_delete" ON public.record_extraction_issues;
