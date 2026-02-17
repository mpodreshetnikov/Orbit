-- Policies for money_cards table

DROP POLICY IF EXISTS "money_cards_select" ON public.money_cards;
CREATE POLICY "money_cards_select" ON public.money_cards
  FOR SELECT TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_cards_insert" ON public.money_cards;
CREATE POLICY "money_cards_insert" ON public.money_cards
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_cards_update" ON public.money_cards;
CREATE POLICY "money_cards_update" ON public.money_cards
  FOR UPDATE TO authenticated
  USING ((select public.is_allowed_user()));

DROP POLICY IF EXISTS "money_cards_delete" ON public.money_cards;
CREATE POLICY "money_cards_delete" ON public.money_cards
  FOR DELETE TO authenticated
  USING ((select public.is_allowed_user()));
