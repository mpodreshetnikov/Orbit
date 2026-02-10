-- Function: money_upsert_transactions_batch(batch_id, payer_person_id, rows)
-- Idempotent insert of transactions + one line item per transaction.
-- Rows must be canonical: account_id, source, external_id?, posted_at, amount, currency,
-- transaction_type, status, merchant_name, mcc, comment, is_transfer, transfer_group_id?,
-- raw_payload?, dedupe_hash, line_item: { title, amount, quantity?, unit?, raw_payload? }.
-- Uses ON CONFLICT (source, external_id) when external_id present, else ON CONFLICT (dedupe_hash).
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
  inserted_count int := 0;
  skipped_count int := 0;
  li jsonb;
  row_idx int := 0;
  row_status text;
  row_message text;
  row_results jsonb[] := '{}';
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('inserted', 0, 'skipped', 0, 'row_results', '[]'::jsonb, 'error', 'rows must be a JSON array');
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    tx_id := NULL;
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
        COALESCE((r->>'is_transfer')::boolean, false),
        (NULLIF(trim(r->>'transfer_group_id'), ''))::uuid,
        r->'raw_payload',
        NULLIF(trim(r->>'dedupe_hash'), '')
      )
      ON CONFLICT (source, external_id) WHERE (external_id IS NOT NULL) DO NOTHING
      RETURNING id INTO tx_id;
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
        COALESCE((r->>'is_transfer')::boolean, false),
        (NULLIF(trim(r->>'transfer_group_id'), ''))::uuid,
        r->'raw_payload',
        trim(r->>'dedupe_hash')
      )
      ON CONFLICT (dedupe_hash) DO NOTHING
      RETURNING id INTO tx_id;
    END IF;

    IF tx_id IS NOT NULL THEN
      inserted_count := inserted_count + 1;
      row_status := 'inserted';
      li := r->'line_item';
      IF li IS NOT NULL THEN
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
    ELSE
      skipped_count := skipped_count + 1;
      row_status := 'skipped';
      row_message := 'Duplicate';
    END IF;
    row_results := array_append(row_results, jsonb_build_object('idx', row_idx, 'status', row_status, 'message', row_message));
    row_idx := row_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', inserted_count,
    'skipped', skipped_count,
    'row_results', (SELECT jsonb_agg(elem ORDER BY (elem->>'idx')::int) FROM unnest(row_results) AS elem)
  );
END;
$$;

COMMENT ON FUNCTION public.money_upsert_transactions_batch(uuid, uuid, jsonb) IS
  'Idempotent batch insert of money transactions and one line item per transaction. Used by the import framework.';
