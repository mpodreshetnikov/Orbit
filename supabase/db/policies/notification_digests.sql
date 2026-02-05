-- Policies for notification_digests table

DROP POLICY IF EXISTS "notification_digests_select" ON public.notification_digests;
CREATE POLICY "notification_digests_select" ON public.notification_digests
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "notification_digests_update" ON public.notification_digests;
CREATE POLICY "notification_digests_update" ON public.notification_digests
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());
