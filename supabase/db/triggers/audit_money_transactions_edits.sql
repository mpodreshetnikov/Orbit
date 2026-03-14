-- Trigger: audit_money_transactions_edits
-- Writes transaction-level audit entries after meaningful updates.

DROP TRIGGER IF EXISTS audit_money_transactions_edits ON public.money_transactions;
CREATE TRIGGER audit_money_transactions_edits
  AFTER UPDATE ON public.money_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.money_write_transaction_edit_audit();
