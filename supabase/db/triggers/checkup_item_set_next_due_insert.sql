-- Trigger: checkup_item_set_next_due_insert
-- Set initial next_due_at when checkup_item is inserted

DROP TRIGGER IF EXISTS checkup_item_set_next_due_insert ON public.checkup_items;
CREATE TRIGGER checkup_item_set_next_due_insert
  BEFORE INSERT ON public.checkup_items
  FOR EACH ROW EXECUTE FUNCTION public.checkup_item_set_next_due_on_insert();
