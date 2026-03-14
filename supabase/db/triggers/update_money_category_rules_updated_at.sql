-- Trigger: update_money_category_rules_updated_at
-- Auto-update updated_at timestamp on money_category_rules table

DROP TRIGGER IF EXISTS update_money_category_rules_updated_at ON public.money_category_rules;
CREATE TRIGGER update_money_category_rules_updated_at
  BEFORE UPDATE ON public.money_category_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

