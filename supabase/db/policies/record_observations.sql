-- Policies for record_observations table

DROP POLICY IF EXISTS "record_observations_select" ON public.record_observations;
CREATE POLICY "record_observations_select" ON public.record_observations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "record_observations_insert" ON public.record_observations;
CREATE POLICY "record_observations_insert" ON public.record_observations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "record_observations_update" ON public.record_observations;
CREATE POLICY "record_observations_update" ON public.record_observations
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

DROP POLICY IF EXISTS "record_observations_delete" ON public.record_observations;
CREATE POLICY "record_observations_delete" ON public.record_observations
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
    )
    AND public.is_allowed_user()
  );
