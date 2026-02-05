-- Policies for persons table

DROP POLICY IF EXISTS "persons_select" ON public.persons;
CREATE POLICY "persons_select" ON public.persons
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

-- Note: No INSERT/UPDATE/DELETE policies - admin only via service role
