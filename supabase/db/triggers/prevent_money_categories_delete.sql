-- Trigger: prevent_money_categories_delete
-- Protects built-in canonical money categories from deletion.

DROP TRIGGER IF EXISTS prevent_money_categories_delete ON public.money_categories;
CREATE TRIGGER prevent_money_categories_delete
  BEFORE DELETE ON public.money_categories
  FOR EACH ROW EXECUTE FUNCTION public.money_categories_prevent_delete();
