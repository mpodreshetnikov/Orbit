-- Function: money_save_transaction_with_line_items(uuid, jsonb, jsonb)
-- Save a transaction and its whole composition in one database transaction.
--
-- Editing a transaction from the browser used to be three to five separate statements —
-- upsert the header, read the current line items, delete the removed ones, update the kept
-- ones one at a time, insert the new ones — with no transaction around them. A connection
-- dropped in the middle left the registry half-changed, with no way back and no retry
-- offered. docs/design/domains/money/ledger-and-line-items.md already forbids partial
-- updates; this is what makes that rule true rather than merely written down.
--
-- SECURITY INVOKER on purpose: row level security must apply exactly as it does to the
-- statements this replaces.

DROP FUNCTION IF EXISTS public.money_save_transaction_with_line_items(uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.money_save_transaction_with_line_items(
  p_transaction_id uuid,
  p_transaction jsonb,
  p_line_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transaction_id uuid := p_transaction_id;
  v_amount numeric;
  v_line_items_sum numeric;
  v_kept_ids uuid[];
  v_result jsonb;
BEGIN
  IF p_transaction IS NULL OR jsonb_typeof(p_transaction) <> 'object' THEN
    RAISE EXCEPTION 'p_transaction must be a JSON object';
  END IF;
  IF p_line_items IS NULL OR jsonb_typeof(p_line_items) <> 'array' THEN
    RAISE EXCEPTION 'p_line_items must be a JSON array';
  END IF;
  IF jsonb_array_length(p_line_items) = 0 THEN
    RAISE EXCEPTION 'A transaction needs at least one line item';
  END IF;

  v_amount := round((p_transaction->>'amount')::numeric, 2);

  SELECT round(sum((item->>'amount')::numeric), 2)
  INTO v_line_items_sum
  FROM jsonb_array_elements(p_line_items) AS item
  WHERE COALESCE(item->>'line_status', 'final') <> 'cancelled';

  -- The same invariant the import path keeps: line items must add up to the operation.
  -- Raising here is what makes the interface show the problem instead of writing a
  -- transaction whose composition silently disagrees with its amount.
  IF abs(COALESCE(v_line_items_sum, 0) - v_amount) > 0.01 THEN
    RAISE EXCEPTION 'Line items sum (%) does not match the transaction amount (%)',
      COALESCE(v_line_items_sum, 0), v_amount;
  END IF;

  IF v_transaction_id IS NULL THEN
    INSERT INTO public.money_transactions (
      payer_person_id,
      account_id,
      card_id,
      brand_id,
      source,
      external_id,
      posted_at,
      amount,
      currency,
      transaction_type,
      status,
      merchant_name,
      mcc,
      comment,
      source_comment,
      cashback_amount,
      cashback_currency,
      operation_icon_url,
      source_category_id,
      source_category_name,
      is_transfer,
      transfer_group_id,
      raw_payload,
      dedupe_hash
    )
    VALUES (
      (p_transaction->>'payer_person_id')::uuid,
      (p_transaction->>'account_id')::uuid,
      NULLIF(p_transaction->>'card_id', '')::uuid,
      NULLIF(p_transaction->>'brand_id', '')::uuid,
      COALESCE(NULLIF(p_transaction->>'source', ''), 'manual'),
      NULLIF(p_transaction->>'external_id', ''),
      (p_transaction->>'posted_at')::timestamptz,
      v_amount,
      (p_transaction->>'currency')::char(3),
      (p_transaction->>'transaction_type')::public.money_transaction_type,
      COALESCE(NULLIF(p_transaction->>'status', ''), 'posted')::public.money_transaction_status,
      NULLIF(p_transaction->>'merchant_name', ''),
      NULLIF(p_transaction->>'mcc', ''),
      NULLIF(p_transaction->>'comment', ''),
      NULLIF(p_transaction->>'source_comment', ''),
      NULLIF(p_transaction->>'cashback_amount', '')::numeric,
      NULLIF(p_transaction->>'cashback_currency', ''),
      NULLIF(p_transaction->>'operation_icon_url', ''),
      NULLIF(p_transaction->>'source_category_id', ''),
      NULLIF(p_transaction->>'source_category_name', ''),
      COALESCE((p_transaction->>'is_transfer')::boolean, false),
      NULLIF(p_transaction->>'transfer_group_id', '')::uuid,
      p_transaction->'raw_payload',
      NULLIF(p_transaction->>'dedupe_hash', '')
    )
    RETURNING id INTO v_transaction_id;
  ELSE
    -- Only keys actually present in the payload are written, so a partial patch does not
    -- blank out fields the caller never mentioned.
    UPDATE public.money_transactions AS transaction
    SET
      account_id = COALESCE(NULLIF(p_transaction->>'account_id', '')::uuid, transaction.account_id),
      card_id = CASE WHEN p_transaction ? 'card_id'
        THEN NULLIF(p_transaction->>'card_id', '')::uuid ELSE transaction.card_id END,
      brand_id = CASE WHEN p_transaction ? 'brand_id'
        THEN NULLIF(p_transaction->>'brand_id', '')::uuid ELSE transaction.brand_id END,
      posted_at = COALESCE((p_transaction->>'posted_at')::timestamptz, transaction.posted_at),
      amount = COALESCE(v_amount, transaction.amount),
      currency = COALESCE((p_transaction->>'currency')::char(3), transaction.currency),
      transaction_type = COALESCE(
        (p_transaction->>'transaction_type')::public.money_transaction_type,
        transaction.transaction_type
      ),
      status = COALESCE(
        (p_transaction->>'status')::public.money_transaction_status,
        transaction.status
      ),
      merchant_name = CASE WHEN p_transaction ? 'merchant_name'
        THEN NULLIF(p_transaction->>'merchant_name', '') ELSE transaction.merchant_name END,
      mcc = CASE WHEN p_transaction ? 'mcc'
        THEN NULLIF(p_transaction->>'mcc', '') ELSE transaction.mcc END,
      comment = CASE WHEN p_transaction ? 'comment'
        THEN NULLIF(p_transaction->>'comment', '') ELSE transaction.comment END,
      source_comment = CASE WHEN p_transaction ? 'source_comment'
        THEN NULLIF(p_transaction->>'source_comment', '') ELSE transaction.source_comment END,
      cashback_amount = CASE WHEN p_transaction ? 'cashback_amount'
        THEN NULLIF(p_transaction->>'cashback_amount', '')::numeric ELSE transaction.cashback_amount END,
      cashback_currency = CASE WHEN p_transaction ? 'cashback_currency'
        THEN NULLIF(p_transaction->>'cashback_currency', '') ELSE transaction.cashback_currency END,
      operation_icon_url = CASE WHEN p_transaction ? 'operation_icon_url'
        THEN NULLIF(p_transaction->>'operation_icon_url', '') ELSE transaction.operation_icon_url END,
      source_category_id = CASE WHEN p_transaction ? 'source_category_id'
        THEN NULLIF(p_transaction->>'source_category_id', '') ELSE transaction.source_category_id END,
      source_category_name = CASE WHEN p_transaction ? 'source_category_name'
        THEN NULLIF(p_transaction->>'source_category_name', '') ELSE transaction.source_category_name END,
      is_transfer = COALESCE((p_transaction->>'is_transfer')::boolean, transaction.is_transfer),
      transfer_group_id = CASE WHEN p_transaction ? 'transfer_group_id'
        THEN NULLIF(p_transaction->>'transfer_group_id', '')::uuid ELSE transaction.transfer_group_id END,
      raw_payload = CASE WHEN p_transaction ? 'raw_payload'
        THEN p_transaction->'raw_payload' ELSE transaction.raw_payload END
    WHERE transaction.id = v_transaction_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transaction % not found', v_transaction_id;
    END IF;
  END IF;

  SELECT array_agg((item->>'id')::uuid)
  INTO v_kept_ids
  FROM jsonb_array_elements(p_line_items) AS item
  WHERE NULLIF(item->>'id', '') IS NOT NULL;

  DELETE FROM public.money_line_items AS line_item
  WHERE line_item.transaction_id = v_transaction_id
    AND (v_kept_ids IS NULL OR NOT (line_item.id = ANY(v_kept_ids)));

  UPDATE public.money_line_items AS line_item
  SET
    title = incoming.title,
    amount = incoming.amount,
    quantity = incoming.quantity,
    unit = incoming.unit,
    line_status = incoming.line_status,
    related_line_item_id = incoming.related_line_item_id,
    category_id = incoming.category_id,
    beneficiary_person_id = incoming.beneficiary_person_id,
    assignment_method = incoming.assignment_method,
    assignment_rule_id = incoming.assignment_rule_id,
    assignment_confidence = incoming.assignment_confidence,
    category_locked_by_user = incoming.category_locked_by_user,
    raw_payload = incoming.raw_payload,
    last_category_rule_id = incoming.last_category_rule_id,
    last_category_rule_run_id = incoming.last_category_rule_run_id,
    category_assigned_at = incoming.category_assigned_at
  FROM (
    SELECT
      (item->>'id')::uuid AS id,
      item->>'title' AS title,
      (item->>'amount')::numeric AS amount,
      NULLIF(item->>'quantity', '')::numeric AS quantity,
      NULLIF(item->>'unit', '') AS unit,
      COALESCE(NULLIF(item->>'line_status', ''), 'final')::public.money_line_status AS line_status,
      NULLIF(item->>'related_line_item_id', '')::uuid AS related_line_item_id,
      NULLIF(item->>'category_id', '')::uuid AS category_id,
      NULLIF(item->>'beneficiary_person_id', '')::uuid AS beneficiary_person_id,
      COALESCE(NULLIF(item->>'assignment_method', ''), 'manual')::public.money_assignment_method AS assignment_method,
      NULLIF(item->>'assignment_rule_id', '')::uuid AS assignment_rule_id,
      NULLIF(item->>'assignment_confidence', '')::numeric AS assignment_confidence,
      COALESCE((item->>'category_locked_by_user')::boolean, false) AS category_locked_by_user,
      item->'raw_payload' AS raw_payload,
      NULLIF(item->>'last_category_rule_id', '')::uuid AS last_category_rule_id,
      NULLIF(item->>'last_category_rule_run_id', '')::uuid AS last_category_rule_run_id,
      NULLIF(item->>'category_assigned_at', '')::timestamptz AS category_assigned_at
    FROM jsonb_array_elements(p_line_items) AS item
    WHERE NULLIF(item->>'id', '') IS NOT NULL
  ) AS incoming
  WHERE line_item.id = incoming.id
    AND line_item.transaction_id = v_transaction_id;

  INSERT INTO public.money_line_items (
    transaction_id,
    title,
    amount,
    quantity,
    unit,
    line_status,
    related_line_item_id,
    category_id,
    beneficiary_person_id,
    assignment_method,
    assignment_rule_id,
    assignment_confidence,
    category_locked_by_user,
    raw_payload,
    last_category_rule_id,
    last_category_rule_run_id,
    category_assigned_at
  )
  SELECT
    v_transaction_id,
    item->>'title',
    (item->>'amount')::numeric,
    NULLIF(item->>'quantity', '')::numeric,
    NULLIF(item->>'unit', ''),
    COALESCE(NULLIF(item->>'line_status', ''), 'final')::public.money_line_status,
    NULLIF(item->>'related_line_item_id', '')::uuid,
    NULLIF(item->>'category_id', '')::uuid,
    NULLIF(item->>'beneficiary_person_id', '')::uuid,
    COALESCE(NULLIF(item->>'assignment_method', ''), 'manual')::public.money_assignment_method,
    NULLIF(item->>'assignment_rule_id', '')::uuid,
    NULLIF(item->>'assignment_confidence', '')::numeric,
    COALESCE((item->>'category_locked_by_user')::boolean, false),
    item->'raw_payload',
    NULLIF(item->>'last_category_rule_id', '')::uuid,
    NULLIF(item->>'last_category_rule_run_id', '')::uuid,
    NULLIF(item->>'category_assigned_at', '')::timestamptz
  FROM jsonb_array_elements(p_line_items) AS item
  WHERE NULLIF(item->>'id', '') IS NULL;

  SELECT to_jsonb(transaction) || jsonb_build_object(
    'line_items',
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(line_item) ORDER BY line_item.created_at, line_item.id)
        FROM public.money_line_items AS line_item
        WHERE line_item.transaction_id = transaction.id
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM public.money_transactions AS transaction
  WHERE transaction.id = v_transaction_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.money_save_transaction_with_line_items(uuid, jsonb, jsonb) IS
  'Create or update a transaction together with its full line item composition in one database transaction; rejects a composition that does not add up to the transaction amount.';
