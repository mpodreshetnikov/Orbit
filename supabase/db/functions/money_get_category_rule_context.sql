-- Function: money_get_category_rule_context(uuid, uuid)
-- Returns the line-item/transaction/account/category payload used by the category rule pipeline.

CREATE OR REPLACE FUNCTION public.money_get_category_rule_context(
  p_line_item_id uuid,
  p_person_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH context_row AS (
    SELECT
      li.id AS line_item_id,
      li.transaction_id,
      li.title AS line_item_title,
      li.amount AS line_item_amount,
      li.quantity,
      li.unit,
      li.line_status,
      li.category_id,
      li.assignment_method,
      li.assignment_rule_id,
      li.assignment_confidence,
      li.raw_payload AS line_item_raw_payload,
      li.category_locked_by_user,
      li.last_category_rule_id,
      li.last_category_rule_run_id,
      li.category_assigned_at,
      t.payer_person_id,
      t.account_id,
      t.source,
      t.posted_at,
      t.amount AS transaction_amount,
      t.currency,
      t.transaction_type,
      t.status AS transaction_status,
      t.merchant_name,
      t.mcc,
      t.comment,
      t.source_comment,
      t.source_category_id,
      t.source_category_name,
      t.cashback_amount,
      t.brand_id,
      t.is_transfer,
      t.raw_payload AS transaction_raw_payload,
      account.source AS account_source,
      account.account_kind,
      current_category.category_kind AS current_category_kind,
      current_category.canonical_category_id AS current_canonical_category_id,
      current_canonical.system_key AS current_canonical_system_key
    FROM public.money_line_items AS li
    JOIN public.money_transactions AS t
      ON t.id = li.transaction_id
    LEFT JOIN public.money_accounts AS account
      ON account.id = t.account_id
    LEFT JOIN public.money_categories AS current_category
      ON current_category.id = li.category_id
    LEFT JOIN public.money_categories AS current_canonical
      ON current_canonical.id = current_category.canonical_category_id
    WHERE li.id = p_line_item_id
      AND (p_person_id IS NULL OR t.payer_person_id = p_person_id)
  )
  SELECT jsonb_build_object(
    'line_item', jsonb_build_object(
      'id', line_item_id,
      'transaction_id', transaction_id,
      'title', line_item_title,
      'amount', line_item_amount,
      'quantity', quantity,
      'unit', unit,
      'line_status', line_status,
      'category_id', category_id,
      'assignment_method', assignment_method,
      'assignment_rule_id', assignment_rule_id,
      'assignment_confidence', assignment_confidence,
      'raw_payload', COALESCE(line_item_raw_payload, '{}'::jsonb),
      'category_locked_by_user', category_locked_by_user,
      'last_category_rule_id', last_category_rule_id,
      'last_category_rule_run_id', last_category_rule_run_id,
      'category_assigned_at', category_assigned_at
    ),
    'transaction', jsonb_build_object(
      'id', transaction_id,
      'payer_person_id', payer_person_id,
      'account_id', account_id,
      'source', source,
      'posted_at', posted_at,
      'amount', transaction_amount,
      'currency', currency,
      'transaction_type', transaction_type,
      'status', transaction_status,
      'merchant_name', merchant_name,
      'mcc', mcc,
      'comment', comment,
      'source_comment', source_comment,
      'source_category_id', source_category_id,
      'source_category_name', source_category_name,
      'cashback_amount', cashback_amount,
      'brand_id', brand_id,
      'is_transfer', is_transfer,
      'raw_payload', COALESCE(transaction_raw_payload, '{}'::jsonb)
    ),
    'account', jsonb_build_object(
      'source', account_source,
      'account_kind', account_kind
    ),
    'current_category', jsonb_build_object(
      'id', category_id,
      'kind', current_category_kind,
      'canonical_category_id', current_canonical_category_id,
      'canonical_system_key', current_canonical_system_key
    ),
    'derived', jsonb_build_object(
      'normalized_line_item_title', NULLIF(regexp_replace(lower(COALESCE(line_item_title, '')), '\s+', ' ', 'g'), ''),
      'normalized_merchant_name', NULLIF(regexp_replace(lower(COALESCE(merchant_name, '')), '\s+', ' ', 'g'), ''),
      'absolute_line_item_amount', ABS(COALESCE(line_item_amount, 0)),
      'unit_price', CASE
        WHEN quantity IS NOT NULL AND quantity <> 0 THEN ABS(COALESCE(line_item_amount, 0) / quantity)
        ELSE NULL
      END,
      'posted_day_of_week', EXTRACT(ISODOW FROM posted_at),
      'posted_month', EXTRACT(MONTH FROM posted_at),
      'current_category_kind', current_category_kind,
      'current_canonical_system_key', current_canonical_system_key,
      'has_receipt_metadata', (
        COALESCE(jsonb_typeof(line_item_raw_payload), 'null') <> 'null'
        OR COALESCE(source_category_id, '') <> ''
        OR COALESCE(source_category_name, '') <> ''
      )
    )
  )
  FROM context_row;
$$;

COMMENT ON FUNCTION public.money_get_category_rule_context(uuid, uuid) IS
  'Builds the joined line-item/transaction/account/category context JSON consumed by the money category rule pipeline.';

