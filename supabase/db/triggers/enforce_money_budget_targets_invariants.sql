-- Trigger: enforce_money_budget_targets_invariants
-- Enforce money budget target overlap rules and normalized month starts.

DROP TRIGGER IF EXISTS enforce_money_budget_targets_invariants ON public.money_budget_targets;
CREATE TRIGGER enforce_money_budget_targets_invariants
  BEFORE INSERT OR UPDATE ON public.money_budget_targets
  FOR EACH ROW EXECUTE FUNCTION public.money_budget_targets_enforce_invariants();
