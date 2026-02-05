-- Trigger: update_checkup_items_updated_at
-- Auto-update updated_at timestamp on checkup_items table

DROP TRIGGER IF EXISTS update_checkup_items_updated_at ON public.checkup_items;
CREATE TRIGGER update_checkup_items_updated_at
  BEFORE UPDATE ON public.checkup_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
