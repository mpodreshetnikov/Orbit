-- Function: money_update_transaction_with_lines(transaction_id, updates, line_items)
-- Changes a transaction and brings its saved line items to the ones given, in one database
-- transaction: either all of it lands or none of it does. Line items with an id the transaction
-- already has are changed, the rest are added, and saved ones missing from the list are removed.
-- Runs as the caller, so row level security decides what may be touched.

DROP FUNCTION IF EXISTS public.money_update_transaction_with_lines(uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.money_update_transaction_with_lines(
  p_transaction_id uuid,
  p_updates jsonb,
  p_line_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transaction public.money_transactions;
  v_line public.money_line_items;
  v_item jsonb;
  v_item_id uuid;
  v_kept_ids uuid[];
  v_lines jsonb := '[]'::jsonb;
BEGIN
  IF p_line_items IS NULL OR jsonb_typeof(p_line_items) <> 'array' THEN
    RAISE EXCEPTION 'p_line_items must be a JSON array';
  END IF;

  SELECT *
  INTO v_transaction
  FROM public.money_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'money transaction % not found', p_transaction_id;
  END IF;

  -- The keys given replace the saved values; who owns the row and its identity never change here.
  v_transaction := jsonb_populate_record(
    v_transaction,
    COALESCE(p_updates, '{}'::jsonb) - 'id' - 'payer_person_id' - 'created_at' - 'updated_at'
  );

  UPDATE public.money_transactions
  SET
    account_id = v_transaction.account_id,
    source = v_transaction.source,
    external_id = v_transaction.external_id,
    posted_at = v_transaction.posted_at,
    amount = v_transaction.amount,
    currency = v_transaction.currency,
    transaction_type = v_transaction.transaction_type,
    status = v_transaction.status,
    merchant_name = v_transaction.merchant_name,
    mcc = v_transaction.mcc,
    comment = v_transaction.comment,
    is_transfer = v_transaction.is_transfer,
    transfer_group_id = v_transaction.transfer_group_id,
    raw_payload = v_transaction.raw_payload,
    dedupe_hash = v_transaction.dedupe_hash,
    card_id = v_transaction.card_id,
    source_comment = v_transaction.source_comment,
    cashback_amount = v_transaction.cashback_amount,
    cashback_currency = v_transaction.cashback_currency,
    brand_id = v_transaction.brand_id,
    operation_icon_url = v_transaction.operation_icon_url,
    source_category_id = v_transaction.source_category_id,
    source_category_name = v_transaction.source_category_name,
    receipt_request_key = v_transaction.receipt_request_key,
    receipt_enrichment_status = v_transaction.receipt_enrichment_status
  WHERE id = p_transaction_id
  RETURNING * INTO v_transaction;

  SELECT COALESCE(array_agg(line.id), ARRAY[]::uuid[])
  INTO v_kept_ids
  FROM public.money_line_items AS line
  WHERE line.transaction_id = p_transaction_id
    AND line.id IN (
      SELECT (item ->> 'id')::uuid
      FROM jsonb_array_elements(p_line_items) AS item
      WHERE item ->> 'id' IS NOT NULL
    );

  DELETE FROM public.money_line_items
  WHERE transaction_id = p_transaction_id
    AND NOT (id = ANY (v_kept_ids));

  FOR v_item IN SELECT item FROM jsonb_array_elements(p_line_items) AS item
  LOOP
    v_item_id := (v_item ->> 'id')::uuid;

    IF v_item_id IS NOT NULL AND v_item_id = ANY (v_kept_ids) THEN
      SELECT *
      INTO v_line
      FROM public.money_line_items
      WHERE id = v_item_id;

      v_line := jsonb_populate_record(
        v_line,
        v_item - 'id' - 'transaction_id' - 'created_at' - 'updated_at' - 'import_hash'
      );

      UPDATE public.money_line_items
      SET
        title = v_line.title,
        amount = v_line.amount,
        quantity = v_line.quantity,
        unit = v_line.unit,
        line_status = v_line.line_status,
        related_line_item_id = v_line.related_line_item_id,
        category_id = v_line.category_id,
        beneficiary_person_id = v_line.beneficiary_person_id,
        assignment_method = v_line.assignment_method,
        assignment_rule_id = v_line.assignment_rule_id,
        assignment_confidence = v_line.assignment_confidence,
        raw_payload = v_line.raw_payload,
        category_locked_by_user = v_line.category_locked_by_user,
        last_category_rule_id = v_line.last_category_rule_id,
        last_category_rule_run_id = v_line.last_category_rule_run_id,
        category_assigned_at = v_line.category_assigned_at
      WHERE id = v_item_id
      RETURNING * INTO v_line;
    ELSE
      v_line := jsonb_populate_record(NULL::public.money_line_items, v_item);

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
        raw_payload,
        category_locked_by_user,
        last_category_rule_id,
        last_category_rule_run_id,
        category_assigned_at
      )
      VALUES (
        p_transaction_id,
        v_line.title,
        v_line.amount,
        v_line.quantity,
        v_line.unit,
        COALESCE(v_line.line_status, 'final'),
        v_line.related_line_item_id,
        v_line.category_id,
        v_line.beneficiary_person_id,
        COALESCE(v_line.assignment_method, 'manual'),
        v_line.assignment_rule_id,
        v_line.assignment_confidence,
        v_line.raw_payload,
        COALESCE(v_line.category_locked_by_user, false),
        v_line.last_category_rule_id,
        v_line.last_category_rule_run_id,
        v_line.category_assigned_at
      )
      RETURNING * INTO v_line;
    END IF;

    v_lines := v_lines || jsonb_build_array(to_jsonb(v_line));
  END LOOP;

  RETURN jsonb_build_object('transaction', to_jsonb(v_transaction), 'line_items', v_lines);
END;
$$;

COMMENT ON FUNCTION public.money_update_transaction_with_lines(uuid, jsonb, jsonb) IS
  'Updates a money transaction and replaces its line items with the given ones in one database transaction; returns the transaction and its line items in the order given.';
