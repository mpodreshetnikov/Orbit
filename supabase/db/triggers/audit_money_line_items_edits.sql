-- Trigger: audit_money_line_items_edits
-- Writes line-item-level audit entries after meaningful updates.

DROP TRIGGER IF EXISTS audit_money_line_items_edits ON public.money_line_items;
CREATE TRIGGER audit_money_line_items_edits
  AFTER UPDATE ON public.money_line_items
  FOR EACH ROW
  EXECUTE FUNCTION public.money_write_transaction_edit_audit();
