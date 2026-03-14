-- Trigger: enforce_money_categories_invariants
-- Keeps canonical/custom money category invariants valid on insert and update.

DROP TRIGGER IF EXISTS enforce_money_categories_invariants ON public.money_categories;
CREATE TRIGGER enforce_money_categories_invariants
  BEFORE INSERT OR UPDATE ON public.money_categories
  FOR EACH ROW EXECUTE FUNCTION public.money_categories_enforce_invariants();
