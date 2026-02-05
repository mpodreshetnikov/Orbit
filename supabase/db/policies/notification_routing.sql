-- Policies for notification_routing table

DROP POLICY IF EXISTS "notification_routing_select" ON public.notification_routing;
CREATE POLICY "notification_routing_select" ON public.notification_routing
  FOR SELECT TO authenticated
  USING (recipient_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notification_routing_insert" ON public.notification_routing;
CREATE POLICY "notification_routing_insert" ON public.notification_routing
  FOR INSERT TO authenticated
  WITH CHECK (recipient_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notification_routing_update" ON public.notification_routing;
CREATE POLICY "notification_routing_update" ON public.notification_routing
  FOR UPDATE TO authenticated
  USING (recipient_user_id = (select auth.uid()))
  WITH CHECK (recipient_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notification_routing_delete" ON public.notification_routing;
CREATE POLICY "notification_routing_delete" ON public.notification_routing
  FOR DELETE TO authenticated
  USING (recipient_user_id = (select auth.uid()));
