-- Policies for money_fx_rates table

DROP POLICY IF EXISTS "money_fx_rates_select" ON public.money_fx_rates;
CREATE POLICY "money_fx_rates_select" ON public.money_fx_rates
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_fx_rates_insert" ON public.money_fx_rates;
CREATE POLICY "money_fx_rates_insert" ON public.money_fx_rates
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_fx_rates_update" ON public.money_fx_rates;
CREATE POLICY "money_fx_rates_update" ON public.money_fx_rates
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_fx_rates_delete" ON public.money_fx_rates;
CREATE POLICY "money_fx_rates_delete" ON public.money_fx_rates
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
