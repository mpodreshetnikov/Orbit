-- Trigger: update_money_line_items_updated_at
-- Auto-update updated_at timestamp on money_line_items table

DROP TRIGGER IF EXISTS update_money_line_items_updated_at ON public.money_line_items;
CREATE TRIGGER update_money_line_items_updated_at
  BEFORE UPDATE ON public.money_line_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
