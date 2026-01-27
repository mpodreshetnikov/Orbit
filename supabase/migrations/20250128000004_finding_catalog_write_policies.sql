-- ============================================================================
-- WRITE POLICIES FOR FINDING TYPE AND BODY SITE CATALOGS
-- Allow authenticated users to insert, update, delete catalog entries
-- ============================================================================

-- Finding Type Catalog Write Policies
CREATE POLICY "Authenticated users can insert finding types"
  ON public.finding_type_catalog FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update finding types"
  ON public.finding_type_catalog FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete finding types"
  ON public.finding_type_catalog FOR DELETE TO authenticated
  USING (true);

-- Body Site Catalog Write Policies
CREATE POLICY "Authenticated users can insert body sites"
  ON public.body_site_catalog FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update body sites"
  ON public.body_site_catalog FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete body sites"
  ON public.body_site_catalog FOR DELETE TO authenticated
  USING (true);
