-- Function: money_rollback_import_batch(batch_id)
-- Undoes an applied import batch in one database transaction: the transactions the batch inserted
-- are deleted with everything hanging off them, the line items it added to transactions that were
-- already there are deleted, and the batch is marked rolled_back. Transactions the batch only
-- matched (skipped rows) stay, because they existed before it. The batch's own rows keep their
-- payloads, so what was imported can still be read and imported again.
-- Runs as the caller, so row level security decides what may be touched.

DROP FUNCTION IF EXISTS public.money_rollback_import_batch(uuid);

CREATE OR REPLACE FUNCTION public.money_rollback_import_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch public.money_import_batches;
  v_transaction_ids uuid[];
  v_line_item_ids uuid[];
  v_deleted_transactions int := 0;
  v_deleted_line_items int := 0;
BEGIN
  SELECT *
  INTO v_batch
  FROM public.money_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'money import batch % not found', p_batch_id;
  END IF;

  IF v_batch.status <> 'completed' THEN
    RAISE EXCEPTION 'money import batch % is %, only a completed batch can be rolled back',
      p_batch_id, v_batch.status;
  END IF;

  SELECT coalesce(array_agg(DISTINCT transaction_id), '{}')
  INTO v_transaction_ids
  FROM public.money_import_batch_rows
  WHERE batch_id = p_batch_id
    AND row_kind = 'transaction'
    AND status = 'inserted'
    AND transaction_id IS NOT NULL;

  -- Line items the batch added to a transaction it did not create. Those under a transaction it
  -- created go with that transaction.
  SELECT coalesce(array_agg(DISTINCT line_item_id), '{}')
  INTO v_line_item_ids
  FROM public.money_import_batch_rows
  WHERE batch_id = p_batch_id
    AND row_kind = 'line_item'
    AND status = 'inserted'
    AND line_item_id IS NOT NULL
    AND (transaction_id IS NULL OR NOT (transaction_id = ANY (v_transaction_ids)));

  DELETE FROM public.money_line_items WHERE id = ANY (v_line_item_ids);
  GET DIAGNOSTICS v_deleted_line_items = ROW_COUNT;

  DELETE FROM public.money_transactions WHERE id = ANY (v_transaction_ids);
  GET DIAGNOSTICS v_deleted_transactions = ROW_COUNT;

  UPDATE public.money_import_batches
  SET status = 'rolled_back',
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'rolled_back_at', now(),
        'rolled_back_transactions', v_deleted_transactions,
        'rolled_back_line_items', v_deleted_line_items
      )
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'rolled_back',
    'deleted_transactions', v_deleted_transactions,
    'deleted_line_items', v_deleted_line_items
  );
END;
$$;

COMMENT ON FUNCTION public.money_rollback_import_batch(uuid) IS
  'Deletes what an applied import batch inserted (its new transactions and the line items it added to existing ones) and marks the batch rolled_back, in one database transaction.';
