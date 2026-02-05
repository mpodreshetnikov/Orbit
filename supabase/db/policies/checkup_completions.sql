-- Policies for checkup_completions table

DROP POLICY IF EXISTS "checkup_completions_select" ON public.checkup_completions;
CREATE POLICY "checkup_completions_select" ON public.checkup_completions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.checkup_items ci
      WHERE ci.id = checkup_item_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "checkup_completions_insert" ON public.checkup_completions;
CREATE POLICY "checkup_completions_insert" ON public.checkup_completions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.checkup_items ci
      WHERE ci.id = checkup_item_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "checkup_completions_update" ON public.checkup_completions;
CREATE POLICY "checkup_completions_update" ON public.checkup_completions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.checkup_items ci
      WHERE ci.id = checkup_item_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "checkup_completions_delete" ON public.checkup_completions;
CREATE POLICY "checkup_completions_delete" ON public.checkup_completions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.checkup_items ci
      WHERE ci.id = checkup_item_id
    )
    AND (select public.is_allowed_user())
  );
