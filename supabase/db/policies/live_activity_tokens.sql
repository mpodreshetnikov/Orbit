-- Policies for live_activity_tokens table

DROP POLICY IF EXISTS "live_activity_tokens_select" ON public.live_activity_tokens;
CREATE POLICY "live_activity_tokens_select" ON public.live_activity_tokens
  FOR SELECT TO authenticated
  USING (auth_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "live_activity_tokens_insert" ON public.live_activity_tokens;
CREATE POLICY "live_activity_tokens_insert" ON public.live_activity_tokens
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "live_activity_tokens_update" ON public.live_activity_tokens;
CREATE POLICY "live_activity_tokens_update" ON public.live_activity_tokens
  FOR UPDATE TO authenticated
  USING (auth_user_id = (select auth.uid()))
  WITH CHECK (auth_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "live_activity_tokens_delete" ON public.live_activity_tokens;
CREATE POLICY "live_activity_tokens_delete" ON public.live_activity_tokens
  FOR DELETE TO authenticated
  USING (auth_user_id = (select auth.uid()));
