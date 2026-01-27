-- ============================================================================
-- RLS POLICIES FOR OBSERVATION CATALOG WRITE OPERATIONS
-- Allow authenticated users from allowed_users to manage the catalog
-- ============================================================================

-- RLS Policy: Allowed users can insert observations
CREATE POLICY "Allowed users can insert observation catalog"
  ON public.observation_catalog FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- RLS Policy: Allowed users can update observations
CREATE POLICY "Allowed users can update observation catalog"
  ON public.observation_catalog FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );

-- RLS Policy: Allowed users can delete observations
CREATE POLICY "Allowed users can delete observation catalog"
  ON public.observation_catalog FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.allowed_users au
      WHERE au.auth_user_id = auth.uid()
         OR au.email = auth.email()
    )
  );
