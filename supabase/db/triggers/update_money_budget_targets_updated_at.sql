-- Trigger: update_money_budget_targets_updated_at
-- Auto-update updated_at timestamp on money_budget_targets table

DROP TRIGGER IF EXISTS update_money_budget_targets_updated_at ON public.money_budget_targets;
CREATE TRIGGER update_money_budget_targets_updated_at
  BEFORE UPDATE ON public.money_budget_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
