-- Policies for med_dose_events table

DROP POLICY IF EXISTS "med_dose_events_select" ON public.med_dose_events;
CREATE POLICY "med_dose_events_select" ON public.med_dose_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.med_regimens r
      WHERE r.id = regimen_id
    )
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "med_dose_events_insert" ON public.med_dose_events;
CREATE POLICY "med_dose_events_insert" ON public.med_dose_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.med_regimens r
      WHERE r.id = regimen_id
    )
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "med_dose_events_update" ON public.med_dose_events;
CREATE POLICY "med_dose_events_update" ON public.med_dose_events
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.med_regimens r
      WHERE r.id = regimen_id
    )
    AND public.is_allowed_user()
  );

DROP POLICY IF EXISTS "med_dose_events_delete" ON public.med_dose_events;
CREATE POLICY "med_dose_events_delete" ON public.med_dose_events
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.med_regimens r
      WHERE r.id = regimen_id
    )
    AND public.is_allowed_user()
  );
