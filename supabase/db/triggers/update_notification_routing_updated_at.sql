-- Trigger: update_notification_routing_updated_at
-- Auto-update updated_at timestamp on notification_routing table

DROP TRIGGER IF EXISTS update_notification_routing_updated_at ON public.notification_routing;
CREATE TRIGGER update_notification_routing_updated_at
  BEFORE UPDATE ON public.notification_routing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
