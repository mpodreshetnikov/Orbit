-- Policies for money_transaction_edit_audits table

DROP POLICY IF EXISTS "money_transaction_edit_audits_select" ON public.money_transaction_edit_audits;
CREATE POLICY "money_transaction_edit_audits_select" ON public.money_transaction_edit_audits
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));
