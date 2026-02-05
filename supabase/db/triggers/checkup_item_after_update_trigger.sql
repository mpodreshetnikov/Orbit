-- Trigger: checkup_item_after_update_trigger
-- Recompute next_due_at when checkup schedule changes

DROP TRIGGER IF EXISTS checkup_item_after_update_trigger ON public.checkup_items;
CREATE TRIGGER checkup_item_after_update_trigger
  AFTER UPDATE ON public.checkup_items
  FOR EACH ROW EXECUTE FUNCTION public.checkup_item_after_update();
