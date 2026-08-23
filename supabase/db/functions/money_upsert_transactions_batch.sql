-- Function: money_upsert_transactions_batch(batch_id, payer_person_id, rows)
-- Idempotent insert of transactions + one line item per transaction.
-- Rows must be canonical: account_id, source, external_id?, posted_at, amount, currency,
-- transaction_type, status, merchant_name, mcc, comment, is_transfer, transfer_group_id?,
-- raw_payload?, dedupe_hash, line_item: { title, amount, quantity?, unit?, raw_payload? }.
-- Uses ON CONFLICT (payer_person_id, source, external_id) when external_id present, else
-- ON CONFLICT (payer_person_id, dedupe_hash). Identity is scoped to the payer: see
-- 20260814093000_scope_money_transaction_identity.sql.
-- dedupe_hash must be NOT NULL when external_id is null (e.g. file imports).

DROP FUNCTION IF EXISTS public.money_upsert_transactions_batch(uuid, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.money_upsert_transactions_batch(
  p_batch_id uuid,
  p_payer_person_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  tx_id uuid;
  tx_inserted boolean;
  inserted_count int := 0;
  skipped_count int := 0;
  li jsonb;
  row_idx int := 0;
  row_status text;
  row_message text;
  row_results jsonb[] := ARRAY[]::jsonb[];
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('inserted', 0, 'skipped', 0, 'row_results', '[]'::jsonb, 'error', 'rows must be a JSON array');
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    tx_id := NULL;
    tx_inserted := false;
    row_status := 'skipped';
    row_message := NULL;
    IF r->'external_id' IS NOT NULL AND (r->>'external_id') <> '' THEN
      INSERT INTO public.money_transactions (
        payer_person_id,
        account_id,
        card_id,
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
        brand_id,
        receipt_request_key,
        receipt_enrichment_status,
        is_transfer,
        transfer_group_id,
        raw_payload,
        dedupe_hash
      ) VALUES (
        p_payer_person_id,
        (r->>'account_id')::uuid,
        (NULLIF(trim(r->>'card_id'), ''))::uuid,
        COALESCE(r->>'source', 'manual'),
        r->>'external_id',
        (r->>'posted_at')::timestamptz,
        (r->>'amount')::numeric,
        COALESCE(r->>'currency', 'RUB'),
        (r->>'transaction_type')::public.money_transaction_type,
        COALESCE((r->>'status')::public.money_transaction_status, 'posted'),
        NULLIF(trim(r->>'merchant_name'), ''),
        NULLIF(trim(r->>'mcc'), ''),
        NULLIF(trim(r->>'comment'), ''),
        NULLIF(trim(r->>'source_comment'), ''),
        (NULLIF(trim(r->>'cashback_amount'), ''))::numeric,
        NULLIF(trim(r->>'cashback_currency'), ''),
        NULLIF(trim(r->>'operation_icon_url'), ''),
        NULLIF(trim(r->>'source_category_id'), ''),
        NULLIF(trim(r->>'source_category_name'), ''),
        (NULLIF(trim(r->>'brand_id'), ''))::uuid,
        NULLIF(trim(r->>'receipt_request_key'), ''),
        NULLIF(trim(r->>'receipt_enrichment_status'), ''),
        COALESCE((r->>'is_transfer')::boolean, false),
        (NULLIF(trim(r->>'transfer_group_id'), ''))::uuid,
        r->'raw_payload',
        NULLIF(trim(r->>'dedupe_hash'), '')
      )
      ON CONFLICT (payer_person_id, source, external_id) WHERE (external_id IS NOT NULL) DO UPDATE
      SET
        payer_person_id = EXCLUDED.payer_person_id,
        account_id = EXCLUDED.account_id,
        card_id = EXCLUDED.card_id,
        posted_at = EXCLUDED.posted_at,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        transaction_type = EXCLUDED.transaction_type,
        status = EXCLUDED.status,
        merchant_name = EXCLUDED.merchant_name,
        mcc = EXCLUDED.mcc,
        comment = EXCLUDED.comment,
        source_comment = EXCLUDED.source_comment,
        cashback_amount = EXCLUDED.cashback_amount,
        cashback_currency = EXCLUDED.cashback_currency,
        operation_icon_url = EXCLUDED.operation_icon_url,
        source_category_id = EXCLUDED.source_category_id,
        source_category_name = EXCLUDED.source_category_name,
        brand_id = EXCLUDED.brand_id,
        receipt_request_key = EXCLUDED.receipt_request_key,
        receipt_enrichment_status = EXCLUDED.receipt_enrichment_status,
        is_transfer = EXCLUDED.is_transfer,
        transfer_group_id = EXCLUDED.transfer_group_id,
        raw_payload = EXCLUDED.raw_payload,
        dedupe_hash = EXCLUDED.dedupe_hash
      RETURNING id, (xmax = 0) INTO tx_id, tx_inserted;
    ELSE
      IF r->>'dedupe_hash' IS NULL OR trim(r->>'dedupe_hash') = '' THEN
        skipped_count := skipped_count + 1;
        row_status := 'skipped';
        row_message := 'Missing dedupe_hash';
        row_results := array_append(row_results, jsonb_build_object('idx', row_idx, 'status', row_status, 'message', row_message));
        row_idx := row_idx + 1;
        CONTINUE;
      END IF;
      INSERT INTO public.money_transactions (
        payer_person_id,
        account_id,
        card_id,
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
        brand_id,
        receipt_request_key,
        receipt_enrichment_status,
        is_transfer,
        transfer_group_id,
        raw_payload,
        dedupe_hash
      ) VALUES (
        p_payer_person_id,
        (r->>'account_id')::uuid,
        (NULLIF(trim(r->>'card_id'), ''))::uuid,
        COALESCE(r->>'source', 'manual'),
        NULL,
        (r->>'posted_at')::timestamptz,
        (r->>'amount')::numeric,
        COALESCE(r->>'currency', 'RUB'),
        (r->>'transaction_type')::public.money_transaction_type,
        COALESCE((r->>'status')::public.money_transaction_status, 'posted'),
        NULLIF(trim(r->>'merchant_name'), ''),
        NULLIF(trim(r->>'mcc'), ''),
        NULLIF(trim(r->>'comment'), ''),
        NULLIF(trim(r->>'source_comment'), ''),
        (NULLIF(trim(r->>'cashback_amount'), ''))::numeric,
        NULLIF(trim(r->>'cashback_currency'), ''),
        NULLIF(trim(r->>'operation_icon_url'), ''),
        NULLIF(trim(r->>'source_category_id'), ''),
        NULLIF(trim(r->>'source_category_name'), ''),
        (NULLIF(trim(r->>'brand_id'), ''))::uuid,
        NULLIF(trim(r->>'receipt_request_key'), ''),
        NULLIF(trim(r->>'receipt_enrichment_status'), ''),
        COALESCE((r->>'is_transfer')::boolean, false),
        (NULLIF(trim(r->>'transfer_group_id'), ''))::uuid,
        r->'raw_payload',
        trim(r->>'dedupe_hash')
      )
      ON CONFLICT (payer_person_id, dedupe_hash) WHERE (dedupe_hash IS NOT NULL) DO UPDATE
      SET
        payer_person_id = EXCLUDED.payer_person_id,
        account_id = EXCLUDED.account_id,
        card_id = EXCLUDED.card_id,
        source = EXCLUDED.source,
        posted_at = EXCLUDED.posted_at,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        transaction_type = EXCLUDED.transaction_type,
        status = EXCLUDED.status,
        merchant_name = EXCLUDED.merchant_name,
        mcc = EXCLUDED.mcc,
        comment = EXCLUDED.comment,
        source_comment = EXCLUDED.source_comment,
        cashback_amount = EXCLUDED.cashback_amount,
        cashback_currency = EXCLUDED.cashback_currency,
        operation_icon_url = EXCLUDED.operation_icon_url,
        source_category_id = EXCLUDED.source_category_id,
        source_category_name = EXCLUDED.source_category_name,
        brand_id = EXCLUDED.brand_id,
        receipt_request_key = EXCLUDED.receipt_request_key,
        receipt_enrichment_status = EXCLUDED.receipt_enrichment_status,
        is_transfer = EXCLUDED.is_transfer,
        transfer_group_id = EXCLUDED.transfer_group_id,
        raw_payload = EXCLUDED.raw_payload
      RETURNING id, (xmax = 0) INTO tx_id, tx_inserted;
    END IF;

    IF tx_id IS NOT NULL THEN
      IF tx_inserted THEN
        inserted_count := inserted_count + 1;
        row_status := 'inserted';
      ELSE
        skipped_count := skipped_count + 1;
        row_status := 'skipped';
        row_message := 'Duplicate';
      END IF;
      li := r->'line_item';
      IF tx_inserted AND li IS NOT NULL THEN
        INSERT INTO public.money_line_items (
          transaction_id,
          title,
          amount,
          quantity,
          unit,
          line_status,
          assignment_method,
          raw_payload
        ) VALUES (
          tx_id,
          COALESCE(trim(li->>'title'), 'Imported'),
          COALESCE((li->>'amount')::numeric, (r->>'amount')::numeric),
          (li->>'quantity')::numeric,
          NULLIF(trim(li->>'unit'), ''),
          'final',
          'import',
          li->'raw_payload'
        );
      END IF;
    END IF;
    row_results := array_append(row_results, jsonb_build_object('idx', row_idx, 'status', row_status, 'message', row_message));
    row_idx := row_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'inserted', inserted_count,
    'skipped', skipped_count,
    'row_results', (SELECT jsonb_agg(elem ORDER BY (elem->>'idx')::int) FROM unnest(row_results) AS elem)
  );
END;
$$;

COMMENT ON FUNCTION public.money_upsert_transactions_batch(uuid, uuid, jsonb) IS
  'Idempotent batch insert of money transactions and one line item per transaction. Used by the import framework.';
