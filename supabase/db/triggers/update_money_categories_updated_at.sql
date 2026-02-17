-- Trigger: update_money_categories_updated_at
-- Auto-update updated_at timestamp on money_categories table

DROP TRIGGER IF EXISTS update_money_categories_updated_at ON public.money_categories;
CREATE TRIGGER update_money_categories_updated_at
  BEFORE UPDATE ON public.money_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
