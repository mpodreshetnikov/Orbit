-- Function: money_reassign_card_account(card_id, target_account_id)
-- Atomically remaps a card to another account, updates all card transactions to the target account,
-- and merges duplicate same-last4 cards on the target account when needed.

DROP FUNCTION IF EXISTS public.money_reassign_card_account(uuid, uuid);

CREATE OR REPLACE FUNCTION public.money_reassign_card_account(
  p_card_id uuid,
  p_target_account_id uuid
)
RETURNS TABLE (
  resulting_card_id uuid,
  moved_transactions_count integer,
  merged boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source_card record;
  v_target_account record;
  v_existing_target_card_id uuid;
  v_moved_count integer := 0;
BEGIN
  IF p_card_id IS NULL THEN
    RAISE EXCEPTION 'p_card_id is required';
  END IF;

  IF p_target_account_id IS NULL THEN
    RAISE EXCEPTION 'p_target_account_id is required';
  END IF;

  SELECT
    c.id,
    c.account_id,
    c.last4,
    a.owner_person_id,
    a.source
  INTO v_source_card
  FROM public.money_cards c
  JOIN public.money_accounts a ON a.id = c.account_id
  WHERE c.id = p_card_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source card not found';
  END IF;

  SELECT
    a.id,
    a.owner_person_id,
    a.source
  INTO v_target_account
  FROM public.money_accounts a
  WHERE a.id = p_target_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target account not found';
  END IF;

  IF v_source_card.owner_person_id IS DISTINCT FROM v_target_account.owner_person_id THEN
    RAISE EXCEPTION 'Target account must belong to the same person';
  END IF;

  IF v_source_card.source IS DISTINCT FROM v_target_account.source THEN
    RAISE EXCEPTION 'Target account must use the same source';
  END IF;

  IF v_source_card.account_id = p_target_account_id THEN
    UPDATE public.money_transactions
    SET account_id = p_target_account_id
    WHERE card_id = v_source_card.id
      AND account_id IS DISTINCT FROM p_target_account_id;

    GET DIAGNOSTICS v_moved_count = ROW_COUNT;
    RETURN QUERY SELECT v_source_card.id, v_moved_count, false;
    RETURN;
  END IF;

  SELECT c.id
  INTO v_existing_target_card_id
  FROM public.money_cards c
  WHERE c.account_id = p_target_account_id
    AND c.last4 = v_source_card.last4
  LIMIT 1
  FOR UPDATE;

  IF v_existing_target_card_id IS NOT NULL AND v_existing_target_card_id <> v_source_card.id THEN
    UPDATE public.money_transactions
    SET
      account_id = p_target_account_id,
      card_id = v_existing_target_card_id
    WHERE card_id = v_source_card.id;

    GET DIAGNOSTICS v_moved_count = ROW_COUNT;

    DELETE FROM public.money_cards
    WHERE id = v_source_card.id;

    RETURN QUERY SELECT v_existing_target_card_id, v_moved_count, true;
    RETURN;
  END IF;

  BEGIN
    UPDATE public.money_cards
    SET account_id = p_target_account_id
    WHERE id = v_source_card.id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT c.id
      INTO v_existing_target_card_id
      FROM public.money_cards c
      WHERE c.account_id = p_target_account_id
        AND c.last4 = v_source_card.last4
      LIMIT 1;

      IF v_existing_target_card_id IS NULL THEN
        RAISE;
      END IF;

      UPDATE public.money_transactions
      SET
        account_id = p_target_account_id,
        card_id = v_existing_target_card_id
      WHERE card_id = v_source_card.id;

      GET DIAGNOSTICS v_moved_count = ROW_COUNT;

      DELETE FROM public.money_cards
      WHERE id = v_source_card.id;

      RETURN QUERY SELECT v_existing_target_card_id, v_moved_count, true;
      RETURN;
  END;

  UPDATE public.money_transactions
  SET account_id = p_target_account_id
  WHERE card_id = v_source_card.id;

  GET DIAGNOSTICS v_moved_count = ROW_COUNT;
  RETURN QUERY SELECT v_source_card.id, v_moved_count, false;
END;
$$;

COMMENT ON FUNCTION public.money_reassign_card_account(uuid, uuid) IS
  'Atomically remaps money card account ownership with transaction backfill and same-last4 merge on target account.';
