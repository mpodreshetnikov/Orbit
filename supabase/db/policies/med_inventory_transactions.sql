-- Policies for med_inventory_transactions table

DROP POLICY IF EXISTS "med_inventory_transactions_select" ON public.med_inventory_transactions;
CREATE POLICY "med_inventory_transactions_select" ON public.med_inventory_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.med_regimens r
      WHERE r.id = regimen_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "med_inventory_transactions_insert" ON public.med_inventory_transactions;
CREATE POLICY "med_inventory_transactions_insert" ON public.med_inventory_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.med_regimens r
      WHERE r.id = regimen_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "med_inventory_transactions_update" ON public.med_inventory_transactions;
CREATE POLICY "med_inventory_transactions_update" ON public.med_inventory_transactions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.med_regimens r
      WHERE r.id = regimen_id
    )
    AND (select public.is_allowed_user())
  );

DROP POLICY IF EXISTS "med_inventory_transactions_delete" ON public.med_inventory_transactions;
CREATE POLICY "med_inventory_transactions_delete" ON public.med_inventory_transactions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.med_regimens r
      WHERE r.id = regimen_id
    )
    AND (select public.is_allowed_user())
  );
